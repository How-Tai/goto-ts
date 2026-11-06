"""Replay bounded verdict fixtures through the actual batch evaluator; no programs run."""
import ast,contextlib,io,json,math,sys,traceback
from pathlib import Path
from types import SimpleNamespace as N
from enum import Enum
from dataclasses import dataclass

class VerdictStatus(Enum):
    accept='ACCEPTED';partial='PARTIAL';reject='REJECTED';skip='SKIPPED';runtimeErr='RUNTIME_ERROR'
class SubmissionStatus(Enum):
    accept='accept';reject='reject';judgeError='judgeError'
class SubtaskOption(Enum):
    sum='sum';min='min';max='max'
@dataclass
class GroupResult:
    score:float;fullScore:float;verdicts:list
@dataclass
class VerdictTestcase:
    status:VerdictStatus;percent:float;timeUse:float;memUse:int
@dataclass
class ResultDTO:
    id:int;result:str;score:float;sumTime:float;memUse:int;errmsg:object;status:SubmissionStatus;fullResult:list

source=Path(sys.argv[1] if len(sys.argv)>1 else Path(__file__).with_name('evaluate')/'classic.py')
tree=ast.parse(source.read_text());function=next(v for v in tree.body if isinstance(v,ast.FunctionDef) and v.name=='evaluate')
symbols={VerdictStatus.accept:'P',VerdictStatus.partial:'X',VerdictStatus.reject:'-',VerdictStatus.skip:'S'}
namespace={**globals(),'EvaluateData':object,'ProblemTaskDTO':object,'printHeader':lambda*a:None,'langCMD':N(get=lambda*a:1),'osEnv':N(GRADER_TIME_FACTOR=1),'verdictSymbol':symbols.get,'verdictsColorSymbol':symbols.get,'JudgeInfrastructureError':RuntimeError}
exec(compile(ast.Module(body=[function],type_ignores=[]),str(source),'exec'),namespace)
checks=[]
def run(label,groups,expected,status='reject'):
    cases={};subtasks=[];case=0
    for weight,values,option,group in groups:
        ids=[]
        for value in values:
            case+=1;ids.append(case);cases[case]=value
        subtasks.append(N(cases=ids,score=weight,group=group,require=[],option=SubtaskOption(option)))
    def verdict(_root,number,*_args):
        value=cases[number]
        return VerdictTestcase(VerdictStatus.accept if value==1 else VerdictStatus.partial if value>0 else VerdictStatus.reject,value,.001,1024)
    namespace['excuteAndVerdict']=verdict
    submission=N(id=805,language='cpp',timeLimit=1000,memoryLimit=64,contestId=None,problemPath='/unused',maxScore=100)
    data=N(submission=submission,judgeType=N(value='fixture'),srcPath='/unused')
    with contextlib.redirect_stdout(io.StringIO()):result=namespace['evaluate'](data,'/unused',True,lambda*a:None,N(orderIndSubtask=list(range(len(groups))),subtasks=subtasks))
    assert math.isclose(result.score,expected,rel_tol=0,abs_tol=1e-9),(label,result.score,expected)
    assert result.status.value==status,(label,result.status)
    checks.append({'test':label,'score':result.score,'status':result.status.value})
    return result

last=[1.]*40
for index,value in [(2,.9106416928094863),(14,.8961195807649239),(15,.90267093384844),(21,.9759000729485332)]:last[index]=value
replay=run('submission-805-replay',[(20,[1]*24,'sum',False),(5,[1]*8,'sum',False),(15,[1]*16,'sum',False),(60,last,'sum',False)],99.52799842055708)
assert math.isclose(replay.fullResult[3].score,59.52799842055708,abs_tol=1e-9)
run('all-correct',[(100,[1,1],'sum',False)],100,'accept')
run('all-wrong',[(100,[0,0],'sum',False)],0)
run('average-partial',[(100,[1,.3333333333333333],'sum',False)],66.66666666666666)
run('minimum-partial',[(100,[1,.3333333333333333],'min',False)],33.33333333333333)
run('maximum-partial',[(100,[.1,.3333333333333333],'max',False)],33.33333333333333)
run('group-is-all-or-nothing',[(100,[1,.9],'sum',True)],0)
run('group-all-correct',[(100,[1,1],'sum',True)],100,'accept')
run('fractional-weight-normalization',[(.5,[1],'sum',False),(1,[.5],'sum',False)],66.66666666666667)
print(json.dumps({'passed':True,'checks':checks,'contestProgramsExecuted':0,'databaseWrites':0}))
