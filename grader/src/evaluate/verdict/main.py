from DTO.verdictTestcase import VerdictTestcase
from DTO.testcaseData import TestcaseData
from constants.Enums import JudgeType, VerdictStatus
import cmdManager as langCMD
from message import *
from handle import isolateMetaReader, error

from evaluate.verdict import standard, cppCheck, ogogi, thaco

from pathlib import Path
import subprocess
import os
import time
import signal
from grader_safety import SandboxHealthError, infrastructure_command, watchdog_phase, record_runtime_failure
from memory_limits import prepare_testcase as prepare_memory_group, was_memory_killed

MEMORY_LIMIT_EXIT = 69696970


@watchdog_phase('testcase preparation and status', 60)
def excute(problemPath: str, testcase: int, timeLimit: float, memoryLimit: int, language: str, sourcePath: str, isoPath, useControlGroup:bool = False):
    from sandbox_security import (sandbox_args, run_bounded, execution_command,
                                  prepare_testcase, copy_testcase_output, OUTPUT_KIB)
    if not isoPath:
        raise RuntimeError("Submission execution requires Isolate; unsafe fallback disabled.")
    prepare_testcase(isoPath)
    memory_group = prepare_memory_group(memoryLimit)
    command = execution_command(langCMD.get(language, 'execute'), sourcePath, isoPath)
    args = sandbox_args(useControlGroup, isoPath) + [
        '--meta=isoResult.txt', '--stdout=output.txt', '--stderr=error.txt',
        f'--time={timeLimit / 1000}',
        f'--cg-mem={memoryLimit}' if memory_group else f'--mem={memoryLimit}',
        f'--wall-time={(2 * timeLimit / 1000) + 1}', f'--fsize={OUTPUT_KIB}',
        '--run', '--'] + command
    meta = Path('env/isoResult.txt')
    meta.unlink(missing_ok=True)
    with open(Path(problemPath) / f'{int(testcase)}.in', 'rb') as input_stream:
        run_bounded(args, (2 * timeLimit / 1000) + 3, watchdog_name=f'testcase {testcase} execution', cwd='env',
                    stdin=input_stream, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not meta.is_file():
        raise SandboxHealthError('Sandbox produced no testcase status.')
    isoResult = isolateMetaReader(meta.read_text())
    if isoResult.get('status') == 'XX':
        raise SandboxHealthError('Sandbox reported an infrastructure error.')
    if was_memory_killed(isoResult):
        exitCode = MEMORY_LIMIT_EXIT
    elif isoResult.get('status') == 'TO':
        exitCode = 124
    elif 'exitsig' in isoResult:
        exitCode = int(isoResult['exitsig'])
    else:
        exitCode = int(isoResult.get('exitcode', 0))
    timeUse = float(isoResult['time'])
    memUse = int(isoResult['cg-mem' if useControlGroup else 'max-rss'])
    os.chmod('env', 0o750)
    output_files = {}
    for name in ['output.txt', 'error.txt']:
        output_files[name] = copy_testcase_output(isoPath, name, Path('env') / name)
        if not output_files[name] and exitCode == 0:
            exitCode = 1
    if exitCode not in (0, 124, MEMORY_LIMIT_EXIT):
        record_runtime_failure(problemPath, testcase, language, isoPath, isoResult, exitCode, output_files)
    return exitCode, timeUse, memUse




def getJudgeType(problemPath : str) -> JudgeType:
    from checker_sandbox import prepare as prepare_checker
    if Path(f"{problemPath}/interactive_script.py").is_file():
        prepare_checker(problemPath, 'interactive_script.py')
        return JudgeType.ogogi

    if Path(f"{problemPath}/check.cpp").is_file():
        prepare_checker(problemPath, 'check.cpp')
        return JudgeType.cppCheck

    if Path(f"{problemPath}/thaco.cpp").is_file() or Path(f"{problemPath}/partial.cpp").is_file():
        judgeFile = "thaco.cpp" if Path(f"{problemPath}/thaco.cpp").is_file() else "partial.cpp"
        prepare_checker(problemPath, judgeFile)
        return JudgeType.thaco

    return JudgeType.standard


@watchdog_phase('answer checking', 75)
def checkAnswer(problemPath: str, userPath: str, solPath: str, testCase: int, srcPath: str, judgeType: JudgeType):
    testCaseDto = TestcaseData(userPath, solPath, testCase, srcPath)

    if judgeType == JudgeType.cppCheck:
        result = cppCheck.getVerdict(testCaseDto, problemPath)
    elif judgeType == JudgeType.ogogi:
        result = ogogi.getVerdict(testCaseDto, problemPath)
    elif judgeType == JudgeType.thaco:
        result = thaco.getVerdict(testCaseDto, problemPath)
    else:  # ? use standard
        result = standard.getVerdict(testCaseDto)

    return result


def excuteAndVerdict(problemPath: str, testcase: int, timeLimit: float, memoryLimit: int, language: str, sourcePath: str, isoPath, judgeType: JudgeType) -> VerdictTestcase:
    exitCode, timeDiff, memUse = excute(
        problemPath, testcase, timeLimit, memoryLimit, language, sourcePath, isoPath)
    if exitCode == MEMORY_LIMIT_EXIT:
        return VerdictTestcase(VerdictStatus.memoryExceed, 0.0, timeDiff, memUse)
    errSymbol = error(exitCode)

    if not errSymbol:
        # ? if no error
        userOutputPath = "env/output.txt"
        probOutputPath = f"{problemPath}/{testcase}.sol"

        verdictStatus, percentScore = checkAnswer(
            problemPath, userOutputPath, probOutputPath, testcase, sourcePath, judgeType)

        return VerdictTestcase(verdictStatus, percentScore, timeDiff, memUse)
    elif errSymbol == "TLE":
        return VerdictTestcase(VerdictStatus.timeExceed, 0.0, timeDiff, memUse)
    else:
        return VerdictTestcase(VerdictStatus.runtimeErr, 0.0, timeDiff, memUse)
