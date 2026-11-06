from DTO.testcaseData import TestcaseData
from constants.Enums import VerdictStatus

import subprocess
import os
import signal
from grader_safety import CHECKER_MEMORY_MIB, infrastructure_command
from checker_sandbox import run as run_checker


def getVerdict(testCaseDto: TestcaseData, problemPath: str):
    result = run_checker('python', testCaseDto, problemPath)

    result = result.decode(encoding="utf8")
    if len(result.strip()) != 1:
        raise Exception(f"PROBLEM\nOutput from interactive_script.py is not valid\nExpected 1 character but got {result.strip()}")

    if result.strip() == "P":
        return (VerdictStatus.accept, 1.0)
    return (VerdictStatus.reject, 1.0)
