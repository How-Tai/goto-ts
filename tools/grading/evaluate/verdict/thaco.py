from pathlib import Path
import subprocess
import signal
import os
import math
from grader_safety import CHECKER_MEMORY_MIB, infrastructure_command
from DTO.testcaseData import TestcaseData
from constants.Enums import VerdictStatus
from checker_sandbox import run as run_checker


def getVerdict(testCaseDto: TestcaseData, problemPath: str):
    resultScore = run_checker('thaco', testCaseDto, problemPath)

    try:
        resultScore = float(resultScore.strip())
    except:
        raise Exception(f"PROBLEM\nthaco.cpp return invalid score\nExpected float but got {resultScore.strip()}")
    if not math.isfinite(resultScore) or not 0 <= resultScore <= 1:
        raise Exception('PROBLEM\nCustom checker returned a score outside [0,1].')

    if abs(resultScore - 1.0) <= 1e-4:  # ? if very close to one
        return (VerdictStatus.accept, 1.0)
    elif abs(resultScore) <= 1e-4:  # ? if very close to zero
        return (VerdictStatus.reject, 0)

    return (VerdictStatus.partial, resultScore)
