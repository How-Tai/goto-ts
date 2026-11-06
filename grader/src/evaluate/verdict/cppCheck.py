from pathlib import Path
import subprocess
import signal
import os
import shutil
from grader_safety import CHECKER_MEMORY_MIB, infrastructure_command
from DTO.testcaseData import TestcaseData
from constants.Enums import VerdictStatus
from message import *
from checker_sandbox import run as run_checker


def getVerdict(testCaseDto: TestcaseData, problemPath: str):
    result = run_checker('cpp', testCaseDto, problemPath).decode('utf-8')

    if len(result.strip()) != 1:
        raise Exception(f"PROBLEM\ngrader_result.txt is not valid\nExpected 1 character but got {result.strip()}")
    if result.strip() == "P":
        return (VerdictStatus.accept, 1.0)
    return (VerdictStatus.reject, 1.0)
