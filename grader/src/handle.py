import codecs
import os
import signal
import time, datetime
import subprocess
import yaml
from os import path
from pathlib import Path
from random import randint
from DTO.result import ResultDTO
from DTO.submission import SubmissionDTO
from constants.LoggingMsg import Logging

from message import *
from constants.osDotEnv import *
import cmdManager as langCMD
from constants.Enums import *

MAX_ERROR_LINE = int(osEnv.GRADER_MAX_ERROR_LINE)


def strToBool(value: str) -> bool:
    if value.lower() == "false" or value.lower() == "f":
        return False
    return True


def testEnv():
    if not path.exists("env"):
        os.mkdir("env")


def prepareLoging(sub: SubmissionDTO):
    if strToBool(osEnv.GRADER_ENABLE_OFFLINE_LOGGING) == False:
        return

    thisTime = time.localtime(time.time())
    folderName = f"{thisTime.tm_year}{thisTime.tm_mon:02d}{thisTime.tm_mday:02d}"
    if not path.exists("./Logging"):
        os.mkdir("./Logging")

    if not path.exists(f"./Logging/{folderName}"):
        os.mkdir(f"./Logging/{folderName}")

    replaces = [
        ("subId", sub.id),
        ("userId", sub.userId),
        ("lang", sub.language),
        ("proId", sub.problemId),
        ("proSec", sub.timeLimit),
        ("proMem", sub.memoryLimit),
        ("code", sub.sourceCode),
        # ("resScore"),
        # ("resVerdict"),
        # ("resTime"),
        # ("resMem"),
        # ("resErrMsg"),
    ]
    strContent = Logging.noResult
    for e in replaces:
        strContent = strContent.replace(f"<!{e[0]}!>", str(e[1]))

    fileWrite(f"./Logging/{folderName}/{sub.id} waiting.md", strContent)


def resultLoging(sub: SubmissionDTO, res: ResultDTO):
    if strToBool(osEnv.GRADER_ENABLE_OFFLINE_LOGGING) == False:
        return

    thisTime = time.localtime(time.time())
    folderName = f"{thisTime.tm_year}{thisTime.tm_mon:02d}{thisTime.tm_mday:02d}"

    replaces = [
        ("subId", sub.id),
        ("userId", sub.userId),
        ("lang", sub.language),
        ("proId", sub.problemId),
        ("proSec", sub.timeLimit),
        ("proMem", sub.memoryLimit),
        ("code", sub.sourceCode),
        ("resScore", res.score),
        ("resVerdict", res.result),
        ("resTime", res.sumTime),
        ("resMem", res.memUse),
        ("resErrMsg", res.errmsg),
    ]
    strContent = Logging.afterResult
    for e in replaces:
        strContent = strContent.replace(f"<!{e[0]}!>", str(e[1]))

    os.remove(f"./Logging/{folderName}/{sub.id} waiting.md")
    fileWrite(f"./Logging/{folderName}/{sub.id}.md", strContent)


def initIsolate(useControlGroup:bool = True):
    from grader_safety import infrastructure_command, SandboxHealthError
    args = ['isolate'] + (['--cg'] if useControlGroup else [])
    code, _, _ = infrastructure_command(args + ['--cleanup'], 20)
    if code != 0:
        raise SandboxHealthError('Sandbox cleanup failed; worker recovery required.')
    returnCode, output, errors = infrastructure_command(args + ['--init'], 20)
    boxPath = output.decode().strip()
    stdErr = errors.decode(errors='replace').strip()

    if returnCode != 0:
        printFail("isolate", "Can't init")
        print(stdErr)
        printBlod("isolate", "isolate isn't used")
        raise SandboxHealthError("Sandbox initialization failed; execution refused.")
    if not boxPath or not Path(boxPath).is_dir():
        raise SandboxHealthError("Sandbox initialization returned an invalid box.")
    return boxPath + "/box"


def isolateMetaReader(content: str):
    content = content.strip().split("\n")
    resultData = dict()
    for line in content:
        if line.find(":") != 1:
            chunk = line.split(":")
            resultData[chunk[0].strip()] = ":".join(chunk[1:]).strip()

    return resultData


def fileRead(filename):
    try:
        with codecs.open(filename, "r", "utf-8") as f:
            return f.read(65536 if str(filename).endswith('error.txt') else -1).replace("\r", "")
    except:
        return ""


def fileWrite(filename, data):
    with codecs.open(filename, "w", "utf-8") as f:
        f.write(data.replace("\r", ""))


def error(t):
    errCode = None
    if t == 124:
        errCode = "TLE"
        fileWrite("env/error.txt", "Time Limit Exceeded - Process killed.")
    elif t == 139:
        errCode = "SIGSEGV"
        fileWrite(
            "env/error.txt",
            "SIGSEGV||Segmentation fault (core dumped)\n" +
            fileRead("env/error.txt"),
        )
    elif t == 136:
        errCode = "SIGFPE"
        fileWrite(
            "env/error.txt",
            "SIGFPE||Floating point exception\n" + fileRead("env/error.txt"),
        )
    elif t == 134:
        errCode = "SIGABRT"
        fileWrite("env/error.txt", "SIGABRT||Aborted\n" +
                  fileRead("env/error.txt"))
    elif t == 69696969:
        errCode = "ISOERR"
    elif t != 0:
        errCode = "NZEC"
        fileWrite(
            "env/error.txt",
            "NZEC||return code : " + str(t) + "\n" + fileRead("env/error.txt"),
        )
    return errCode


def getRandomName(lenAl: int):
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    result = ""
    for i in range(lenAl):
        result += alphabet[randint(0, len(alphabet)-1)]
    return result


def prepareEnv(problemPath, isoPath):
    import shutil
    if not isoPath:
        raise RuntimeError('Problem libraries require an initialized sandbox.')
    for item in Path(problemPath).iterdir():
        if item.name in ('check.cpp', 'thaco.cpp', 'partial.cpp', 'interactive_script.py'):
            continue
        if item.is_file() and item.suffix in ('.c', '.h', '.cpp', '.py'):
            target = Path(isoPath) / item.name
            shutil.copyfile(item, target)
            target.chmod(0o644)



def createSourceCode(sourceCode, language, isoPath):

    resPath = "./env"
    if isoPath != None:
        resPath = isoPath

    from compile_pipeline import source_name
    compiled_name = source_name()
    srcPath = str(Path(resPath) / compiled_name) if compiled_name else f"""{resPath}/temp{getRandomName(5)}.{langCMD.get(language,"extension")}"""
    fileWrite(srcPath, sourceCode)
    return srcPath


def create(userId, language, sourcePath, problemPath, isoPath):
    from sandbox_security import compile_submission
    if not isoPath:
        raise RuntimeError("Compilation requires Isolate; unsafe fallback disabled.")
    command = langCMD.get(language, "compile")
    custom = Path(problemPath) / "command.yaml"
    if custom.is_file():
        data = yaml.safe_load(custom.read_text())
        if isinstance(data, dict) and isinstance(data.get(language), dict):
            command = data[language].get("compile", command)
    if not isinstance(command, str):
        raise RuntimeError("Invalid compiler command.")
    return compile_submission(language, sourcePath, problemPath, isoPath, command, strToBool(osEnv.USE_CONTROL_GROUP))




def errMsgHandle(errMes: str) -> str:
    # Python
    if errMes.find("During handling of the above exception, another exception occurred:") != -1:
        errMes = errMes[:errMes.find(
            "During handling of the above exception, another exception occurred:")]

    errLines = errMes.split("\n")
    if len(errLines) > MAX_ERROR_LINE:
        errMes = "\n".join(
            errLines[:MAX_ERROR_LINE]) + f"\n\nand {len(errLines) - MAX_ERROR_LINE} more lines..."

    pathCensor = ["./env", "/var/local/lib/isolate/0/box"]
    for e in pathCensor:
        errMes = errMes.replace(e, "")

    return errMes


def stdcmpfunc(fname1, fname2):
    try:
        with open(fname1) as f1, open(fname2) as f2:
            while True:
                f1_line = f1.readline()
                f2_line = f2.readline()
                if f1_line == "" and f2_line == "":
                    return True
                if f1_line.rstrip() != f2_line.rstrip():
                    return False
    except:
        return False


def getMissingSeqNumberFile(pathTo: str, extension: str, number: int):
    """This function will check every file in <pathTo>/{i}.<extension>
    for {i} range from 1 to <number>
    This function will return the list of missing files


    eg. isSeqNumberFile("testP", "in", 5) it will check testP/1.in, testP/2.in, testP/3.in, testP/4.in and testP/5.in 
    It will return [] if 5 of them are exist
    but if one of them missing like 4.in is missing, It will return [4]"""

    result = []

    for i in range(number):
        if not Path(f"{pathTo}/{i + 1}.{extension}").is_file():
            result.append(i+1)

    return result

#! deprecated
def getVerdict(problemId, userPath, solPath, testCase, srcPath, judgeType):
    PROBLEM_PATH = f"./source/{problemId}"

    # OGOGI Judge
    if judgeType == JudgeType.ogogi:
        thisCmd = f"python3 {PROBLEM_PATH}/interactive_script.py {userPath} {PROBLEM_PATH}/ {testCase}"
        proc = subprocess.Popen([thisCmd], shell=True, preexec_fn=os.setsid,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        result, _ = proc.communicate()
        t = proc.returncode
        if os.path.exists("/proc/" + str(proc.pid)):
            # RIP
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)

        result = result.decode(encoding="utf8")
        if t != 0 or len(result.strip()) != 1:
            return "!"  # Judge Error... Bruh
        return result.strip()
    elif judgeType == JudgeType.cppCheck:
        if not Path(f"{PROBLEM_PATH}/binCheck").is_file():
            return "!"

        os.system(f"cp {userPath} ./output.txt")
        thisCmd = f"{PROBLEM_PATH}/binCheck {solPath} {PROBLEM_PATH}/{testCase}.in {srcPath}"
        proc = subprocess.Popen([thisCmd], shell=True, preexec_fn=os.setsid,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        proc.communicate()
        if os.path.exists("/proc/" + str(proc.pid)):
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)  # RIP
        t = proc.returncode

        result = fileRead(f"./grader_result.txt")
        try:
            os.system("rm ./output.txt")
            os.system("rm ./grader_result.txt")
        except:
            pass

        if t != 0 or len(result.strip()) != 1:
            return "!"  # Judge Error... Bruh
        return result.strip().replace("W", "-")

    # Standard Judge
    return stdcmpfunc(userPath, solPath) and "P" or "-"

def getNowTimeStamp():
    now = time.time()
    return datetime.datetime.fromtimestamp(now).strftime('%Y-%m-%dT%H:%M:%S.000Z')
