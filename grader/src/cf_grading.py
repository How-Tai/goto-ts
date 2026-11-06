"""CF jobs use the ordinary durable queue and the existing hardened sandboxes.

Only the trusted worker reads plans and reference/validator sources. All
participant code, validators, reference programs and checkers run in Isolate.
"""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import stat
import time
from psycopg2.extras import Json
from DTO.result import ResultDTO, GroupResult
from DTO.verdictTestcase import VerdictTestcase
from DTO.testcaseData import TestcaseData
from constants.Enums import SubmissionStatus, VerdictStatus
from grader_safety import SandboxHealthError, watchdog_phase, infrastructure_command

ROOT = Path('/usr/src/app/shared-source/.codeforces')
PRIVATE = Path('env/cf-job')
NAMES = {'ACCEPTED':'accepted','REJECTED':'wrong_answer','PARTIAL':'wrong_answer',
         'TIME_LIMIT_EXCEEDED':'time_limit','MEMORY_LIMIT_EXCEEDED':'memory_limit','RUNTIME_ERROR':'runtime_error'}
SYMBOL = {'accepted':'P','wrong_answer':'-','validation_failed':'Validation failed','time_limit':'T','memory_limit':'M','runtime_error':'X','compile_error':'Compile Error','judge_error':'Judge Error'}
class AuthorToolError(Exception):
    def __init__(self,message,diagnostic=''):
        super().__init__(message);self.diagnostic=diagnostic

def lookup(conn, submission_id):
    with conn.cursor() as cur:
        cur.execute('SELECT R.kind,R.phase,R.plan,R."cfProblemId" FROM "cfRun" R WHERE R."submissionId"=%s',(submission_id,))
        row=cur.fetchone()
    conn.commit()
    return dict(zip(('kind','phase','plan','cfProblemId'),row)) if row else None

def _result(submission, verdict, details=None, failed=None, **extra):
    details=details or []
    result=ResultDTO(submission.id,SYMBOL.get(verdict,'-'),100 if verdict=='accepted' else 0,
        int(max([d.timeUse for d in details] or [0])),int(max([d.memUse for d in details] or [0])),
        None, SubmissionStatus.accept if verdict=='accepted' else SubmissionStatus.compileError if verdict=='compile_error' else SubmissionStatus.judgeError if verdict=='judge_error' else SubmissionStatus.reject,
        [GroupResult(100 if verdict=='accepted' else 0,100,details)] if details else [])
    result.cf_outcome={'verdict':verdict,'failedTest':failed,'tested':len(details),'timeMs':result.sumTime,'memoryKiB':result.memUse,**extra}
    if verdict=='compile_error':
        from handle import errMsgHandle
        error=Path('env/error.txt')
        if error.is_file():result.errmsg=errMsgHandle(error.read_bytes()[:65536].decode(errors='replace'))
    return result

@watchdog_phase('CF immutable testcase preparation', 120)
def _bundle(job):
    bundle=job['plan']['bundle']
    if not re.fullmatch('[a-f0-9]{32}',bundle):raise SandboxHealthError('Invalid CF bundle identity.')
    root=ROOT/bundle
    if root.is_symlink() or not root.is_dir():raise SandboxHealthError('CF testcase bundle unavailable.')
    manifest=json.loads((root/'manifest.json').read_text())
    if PRIVATE.exists():shutil.rmtree(PRIVATE)
    PRIVATE.mkdir(mode=0o700)
    for name,digest in manifest.items():
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.(?:in|sol|h|hpp|c|cpp|py)',name):raise SandboxHealthError('Invalid CF bundle file.')
        original=root/name
        if original.is_symlink() or not original.is_file():raise SandboxHealthError('CF bundle file is not regular.')
        if original.suffix in ('.in','.sol'):
            # Only trusted, immutable inputs/answers are shared. Contestants
            # receive stdin, never this directory or other cases.
            (PRIVATE/name).symlink_to(original)
        else:shutil.copy2(original,PRIVATE/name)
    return PRIVATE.resolve()

class Tool:
    """One private compiler/checker session per job; never a shared cache."""
    def __init__(self, source, problem):
        import checker_sandbox as c
        self.c=c
        helpers=PRIVATE/'tool-source'
        if helpers.exists():shutil.rmtree(helpers)
        helpers.mkdir(mode=0o700)
        for header in problem.iterdir():
            if header.suffix in ('.h','.hpp') and header.is_file():shutil.copy2(header,helpers/header.name)
        vendor=Path(__file__).with_name('cf-testlib.h')
        if vendor.is_file() and not (helpers/'testlib.h').exists():shutil.copy2(vendor,helpers/'testlib.h')
        (helpers/'check.cpp').write_text(source)
        try:c.prepare(helpers,'check.cpp')
        except RuntimeError as exc:
            if not str(exc).startswith('PROBLEM\n'):raise
            try:diagnostic=c._read_regular(c.ROOT/str(c._id())/'box/checker-stderr.txt').decode(errors='replace')
            except Exception:diagnostic=''
            raise AuthorToolError('Validator/checker compilation failed.',diagnostic) from exc

    @watchdog_phase('CF isolated validator or checker', 30)
    def run(self, files, checker=False):
        c=self.c;box=c._new_box();c._fresh_group(256*1024)
        c._copy_regular(c.STATE/'binCheck',box/'binCheck',0o555)
        mounts=c.STATE/'cf-case'
        if mounts.exists():shutil.rmtree(mounts)
        mounts.mkdir(mode=0o755)
        for name,source in files.items():c._copy_regular(Path(source).resolve(strict=True),mounts/name,limit=64*1024*1024)
        for name in ('.tmp','.shm'):(box/name).mkdir(mode=0o1777);(box/name).chmod(0o1777)
        meta=Path('env/cf-tool-meta.txt').resolve();meta.unlink(missing_ok=True)
        args=c._native()+['--dir=/usr/src=/opt/otog-empty','--dir=/problem='+str(mounts.resolve()),
            '--dir=/tmp='+str(box/'.tmp')+':rw','--dir=/var/tmp='+str(box/'.tmp')+':rw','--dir=/dev/shm='+str(box/'.shm')+':rw',
            '--env=PATH=/usr/bin:/bin','--env=HOME=/box','--env=LANG=C.UTF-8','--meta='+str(meta),
            '--stdout=tool-output.txt','--stderr=tool-error.txt','--processes=16','--time=10','--wall-time=15',
            '--mem=262144','--cg-mem=262144','--fsize=4096']
        if not checker:args+=['--stdin=/problem/input.txt']
        args+=['--run','--','/box/binCheck']+(['/problem/input.txt','/problem/output.txt','/problem/answer.txt'] if checker else [])
        infrastructure_command(args,20)
        if not meta.is_file():raise SandboxHealthError('CF tool produced no metadata.')
        values=dict(line.split(':',1) for line in meta.read_text().splitlines() if ':' in line)
        if values.get('status')=='XX':raise SandboxHealthError('CF tool sandbox infrastructure error.')
        code=int(values.get('exitcode','-1'))
        try:self.diagnostic=c._read_regular(box/'tool-error.txt')[:65536].decode(errors='replace')
        except (OSError, RuntimeError):self.diagnostic=''
        if values.get('status') not in (None,'RE') or values.get('exitsig') or code<0:
            # A validator/checker crash or resource exhaustion is an authoring
            # error, not proof of a valid counterexample.
            raise AuthorToolError('CF validator/checker crashed or exceeded its limits.',self.diagnostic)
        if checker and code not in (0,1,2):raise AuthorToolError('CF checker reported a problem error.',self.diagnostic)
        return code==0

def _compile(submission,problem,source=None,language=None,config=None):
    import handle
    from sandbox_security import release_sandbox
    release_sandbox()
    box=handle.initIsolate(True)
    handle.prepareEnv(problem,box)
    for header in problem.glob('*.hpp'):
        shutil.copyfile(header,Path(box)/header.name);(Path(box)/header.name).chmod(0o644)
    language=language or submission.language
    import cmdManager
    source_path=str(Path(box)/('solution.'+cmdManager.get(language,'extension')))
    handle.fileWrite(source_path,source if source is not None else submission.sourceCode)
    if config and config.get('taskType')=='library':
        if language!='cpp':raise AuthorToolError('Library tasks require GNU C++17.')
        names=config.get('graderFiles',[])
        if not names or len(names)>16 or len(set(names))!=len(names):raise AuthorToolError('Invalid library grader files.')
        for name in names:
            if not re.fullmatch(r'[A-Za-z0-9_-]+\.(?:cpp|c)',name) or name in ('solution.cpp','solution.c','check.cpp','validator.cpp','reference.cpp','thaco.cpp','partial.cpp'):
                raise AuthorToolError('Invalid library grader filename.')
            if not (problem/name).is_file():raise AuthorToolError('Library grader file is missing: '+name)
        # All linking runs in the existing compiler sandbox. Do not import
        # arbitrary OTOG shell commands into CF.
        from sandbox_security import compile_submission
        command='/usr/bin/g++ -std=gnu++17 -O2 -pipe -I/box [sourcePath] '+' '.join('/box/'+n for n in names)+' -o [binPath]'
        error=compile_submission(language,source_path,str(problem),box,command,True)
    else:error=handle.create(submission.userId,language,source_path,str(problem),box)
    if error:
        from sandbox_security import copy_testcase_output
        copy_testcase_output(box,'error.txt',Path('env/error.txt'))
    return box,source_path,language,error

def _execute(submission,problem,number,compiled):
    from evaluate.verdict.main import excute,MEMORY_LIMIT_EXIT
    import cmdManager
    box,source,language,_=compiled
    from constants.osDotEnv import osEnv
    factor=cmdManager.get(language,'timeFactor')*float(osEnv.GRADER_TIME_FACTOR)
    code,seconds,memory=excute(str(problem),number,submission.timeLimit*factor,submission.memoryLimit*1024,language,source,box,True)
    verdict='memory_limit' if code==MEMORY_LIMIT_EXIT else 'time_limit' if code==124 else 'runtime_error' if code else 'accepted'
    status={'accepted':VerdictStatus.accept,'memory_limit':VerdictStatus.memoryExceed,'time_limit':VerdictStatus.timeExceed,'runtime_error':VerdictStatus.runtimeErr}[verdict]
    return VerdictTestcase(status,1 if verdict=='accepted' else 0,int(seconds*1000//factor),memory),verdict

def _check(problem,number,compiled,tool=None):
    from evaluate.verdict.standard import getVerdict
    source=compiled[1]
    if tool:
        return tool.run({'input.txt':problem/f'{number}.in','output.txt':Path('env/output.txt'),'answer.txt':problem/f'{number}.sol'},checker=True)
    verdict,_=getVerdict(TestcaseData('env/output.txt',str(problem/f'{number}.sol'),number,source))
    return verdict==VerdictStatus.accept

def _hacks(conn,job,submission,problem):
    with conn.cursor() as cur:
        cur.execute('''SELECT H."submissionId" FROM "cfHack" H
          JOIN "cfRun" R ON R."submissionId"=H."submissionId"
          JOIN submission T ON T.id=H."targetId"
          WHERE R."cfProblemId"=%s AND H.state='successful'
          AND (%s='system' OR T."userId"=%s) ORDER BY H."submissionId"''',
          (job['cfProblemId'],job['phase'],submission.userId))
        rows=cur.fetchall()
    conn.commit()
    numbers=[];start=max(job['plan']['config']['fullTests'])
    for offset,(hack_id,) in enumerate(rows,1):
        number=start+offset
        numbers.append((number,hack_id))
    return numbers

@watchdog_phase('CF testcase progress',30)
def _progress(conn,submission,index,total,progress):
    progress(submission.id,index)
    with conn.cursor() as cur:
        cur.execute('UPDATE "cfRun" SET outcome=%s WHERE "submissionId"=%s',(Json({'verdict':'running','currentTest':index,'totalTests':total}),submission.id))
    conn.commit()

def run(conn,submission,job,persist,progress):
    try:return _run(conn,submission,job,persist,progress)
    except AuthorToolError as exc:
        result=_result(submission,'judge_error',reason=str(exc))
        if job['kind'] in ('validator','reference'):result.errmsg=exc.diagnostic[:65536]
        persist(result)

def _run(conn,submission,job,persist,progress):
    cfg=job['plan']['config'];submission.timeLimit=cfg['timeLimit'];submission.memoryLimit=cfg['memoryLimit']
    problem=_bundle(job)
    if job['kind']=='hack':result=_hack(conn,submission,job,problem)
    else:
        compiled=None if job['kind']=='validator' else _compile(submission,problem,config=cfg)
        if compiled and compiled[3]:result=_result(submission,'compile_error')
        else:
            validator=Tool(cfg['validatorSource'],problem) if job['kind']=='validator' else None
            checker=Tool(cfg['checkerSource'],problem) if cfg.get('checkerSource') and not validator else None
            numbers=cfg['fullTests'] if job['kind'] in ('validator','reference') or job['phase']=='system' else cfg['pretests']
            numbers=list(numbers)
            if job['kind'] in ('contest','practice'):numbers+=_hacks(conn,job,submission,problem)
            details=[];verdict='accepted';failed=None;last_progress=0
            for index,number in enumerate(numbers,1):
                hack_case=isinstance(number,tuple)
                if hack_case:
                    number,hack_id=number
                    with conn.cursor() as cur:
                        cur.execute('SELECT input,answer FROM "cfHack" WHERE "submissionId"=%s AND state=\'successful\'',(hack_id,));stored=cur.fetchone()
                    conn.commit()
                    if not stored:raise SandboxHealthError('CF system testcase is no longer available.')
                    (problem/f'{number}.in').write_text(stored[0]);(problem/f'{number}.sol').write_text(stored[1])
                if validator:
                    ok=validator.run({'input.txt':problem/f'{number}.in'})
                    case=VerdictTestcase(VerdictStatus.accept if ok else VerdictStatus.reject,1 if ok else 0,0,0)
                    verdict='accepted' if ok else 'validation_failed'
                else:
                    case,verdict=_execute(submission,problem,number,compiled)
                    if verdict=='accepted' and not _check(problem,number,compiled,checker):
                        verdict='wrong_answer';case.status=VerdictStatus.reject;case.percent=0
                details.append(case)
                if index==1 or index==len(numbers) or time.monotonic()-last_progress>=1:
                    _progress(conn,submission,index,len(numbers),progress);last_progress=time.monotonic()
                if hack_case:
                    (problem/f'{number}.in').unlink();(problem/f'{number}.sol').unlink()
                if verdict!='accepted':failed=number;break
            result=_result(submission,verdict,details,failed)
            if failed is not None:result.cf_outcome['failedTestIndex']=len(details)
            if validator and verdict=='validation_failed':
                result.errmsg=validator.diagnostic
                result.cf_outcome['reason']='Input validator rejected test '+str(failed)+'.'
    persist(result)

def _hack(conn,submission,job,problem):
    from sandbox_security import release_sandbox
    cfg=job['plan']['config']
    with conn.cursor() as cur:
        cur.execute('SELECT input,state,answer FROM "cfHack" WHERE "submissionId"=%s',(submission.id,));row=cur.fetchone()
    conn.commit()
    if not row:raise SandboxHealthError('CF hack record missing.')
    if row[1] not in ('pending','judge_error'):
        # A finalized hack records what happened to that version at contest
        # time. Later resubmissions or a bulk rejudge cannot erase that history.
        return _result(submission,'accepted' if row[1]=='successful' else 'wrong_answer',hackState=row[1],answer=row[2])
    candidate=problem/'candidate';candidate.mkdir(mode=0o700)
    # Copy only author helper files, never original hidden testcases.
    for header in problem.iterdir():
        if header.suffix in ('.h','.hpp','.c','.cpp','.py'):shutil.copy2(header,candidate/header.name)
    (candidate/'1.in').write_text(row[0])
    validator=Tool(cfg['validatorSource'],candidate)
    if not validator.run({'input.txt':candidate/'1.in'}):return _result(submission,'wrong_answer',hackState='invalid')
    reference=_compile(submission,candidate,cfg['referenceSource'],'cpp',cfg)
    if reference[3]:raise AuthorToolError('CF reference solution failed compilation.')
    case,verdict=_execute(submission,candidate,1,reference)
    if verdict!='accepted':raise AuthorToolError('CF reference solution failed on validated hack input.')
    output=Path('env/output.txt')
    if output.stat().st_size>4*1024*1024:raise AuthorToolError('CF reference hack output exceeds storage limit.')
    try:answer=output.read_bytes().decode('utf-8')
    except UnicodeError as exc:raise AuthorToolError('CF reference output must be UTF-8 text.') from exc
    if '\0' in answer:raise AuthorToolError('CF reference output must not contain NUL characters.')
    (candidate/'1.sol').write_text(answer)
    victim=_compile(submission,candidate,config=cfg)
    if victim[3]:raise AuthorToolError('Previously passing CF target failed compilation.')
    checker=Tool(cfg['checkerSource'],candidate) if cfg.get('checkerSource') else None
    case,verdict=_execute(submission,candidate,1,victim)
    if verdict=='accepted' and not _check(candidate,1,victim,checker):verdict='wrong_answer';case.status=VerdictStatus.reject;case.percent=0
    success=verdict!='accepted'
    return _result(submission,'accepted' if success else 'wrong_answer',[case],hackState='successful' if success else 'unsuccessful',answer=answer if success else None,targetVerdict=verdict)

def complete(cursor,submission,result):
    """Called inside persist's transaction, before committing the lease release."""
    cursor.execute('SELECT R.kind,R.phase,R.plan,R."cfProblemId",P."contestId",P.bundle FROM "cfRun" R JOIN "cfProblem" P ON P.id=R."cfProblemId" WHERE R."submissionId"=%s',(submission.id,))
    row=cursor.fetchone()
    if not row:return False
    kind,phase,plan,problem_id,contest_id,bundle=row
    # The API takes the same contest lock before the user/submission locks.
    # Worker persist acquires it first as well (see integration patch).
    outcome=getattr(result,'cf_outcome',{'verdict':'judge_error' if result.status==SubmissionStatus.judgeError else 'compile_error' if result.status==SubmissionStatus.compileError else 'wrong_answer','failedTest':None,'tested':0})
    pre_outcome=dict(outcome)
    if kind=='hack':
        state=outcome.get('hackState','judge_error')
        cursor.execute('SELECT H.state,H.answer,R.outcome FROM "cfHack" H JOIN "cfRun" R ON R."submissionId"=H."submissionId" WHERE H."submissionId"=%s FOR UPDATE OF H',(submission.id,))
        previous=cursor.fetchone()
        finalized=previous and previous[0] not in ('pending','judge_error')
        if finalized:
            state=previous[0]
            outcome=previous[2] or outcome
        elif state in ('successful','unsuccessful','invalid'):
            cursor.execute('''SELECT R."submissionId" FROM "cfRun" R JOIN submission S ON S.id=R."submissionId"
              WHERE R."cfProblemId"=%s AND R.kind='contest' AND S."userId"=%s
              AND R.verified ORDER BY S.id DESC LIMIT 1''',(problem_id,plan['targetUserId']))
            latest=cursor.fetchone()
            cursor.execute('SELECT 1 FROM "cfHack" WHERE "targetId"=%s AND state=\'successful\' AND "submissionId"<>%s',(plan['targetId'],submission.id))
            already=cursor.fetchone()
            if not latest or latest[0]!=plan['targetId'] or already:state='ignored'
            cursor.execute('SELECT status FROM submission WHERE id=%s FOR UPDATE',(plan['targetId'],))
            target_status=cursor.fetchone()
            if not target_status or target_status[0] in ('waiting','grading'):state='ignored'
        answer=previous[1] if finalized else outcome.pop('answer',None)
        outcome.pop('answer',None)
        outcome['hackState']=state
        cursor.execute('UPDATE "cfHack" SET state=%s,answer=%s WHERE "submissionId"=%s',(state,answer if state=='successful' else None,submission.id))
        if state=='successful':
            cursor.execute('UPDATE "cfRun" SET outcome=jsonb_build_object(\'verdict\',\'hacked\') WHERE "submissionId"=%s',(plan['targetId'],))
            cursor.execute('UPDATE submission SET status=\'reject\',"updateDate"=now() WHERE id=%s AND status NOT IN (\'waiting\',\'grading\')',(plan['targetId'],))
            cursor.execute('UPDATE "submissionResult" SET result=\'-\',score=0 WHERE "submissionId"=%s',(plan['targetId'],))
    if kind=='contest':
        if phase=='pretest' and pre_outcome['verdict']=='accepted':
            cursor.execute('UPDATE "cfRun" SET verified=true WHERE "submissionId"=%s',(submission.id,))
        cursor.execute('SELECT 1 FROM "cfHack" WHERE "targetId"=%s AND state=\'successful\' LIMIT 1',(submission.id,))
        if cursor.fetchone():
            outcome['verdict']='hacked'
            cursor.execute('UPDATE submission SET status=\'reject\' WHERE id=%s',(submission.id,))
            cursor.execute('UPDATE "submissionResult" SET result=\'-\',score=0 WHERE "submissionId"=%s',(submission.id,))
    cursor.execute('UPDATE "cfRun" SET outcome=%s'+(',"preOutcome"=%s' if kind=='contest' and phase=='pretest' else '')+' WHERE "submissionId"=%s',
        (Json(outcome),Json(pre_outcome),submission.id) if kind=='contest' and phase=='pretest' else (Json(outcome),submission.id))
    if kind in ('validator','reference') and plan['bundle']==bundle:
        cursor.execute('''SELECT kind,outcome->>'verdict' FROM "cfRun" WHERE "cfProblemId"=%s
          AND kind IN ('validator','reference') AND plan->>'bundle'=%s''',(problem_id,bundle))
        checks=cursor.fetchall()
        valid=len(checks)==2 and all(v=='accepted' for _,v in checks)
        failed=any(v and v!='accepted' for _,v in checks)
        cursor.execute('UPDATE "cfProblem" SET validation=%s WHERE id=%s',('valid' if valid else 'invalid' if failed else 'pending',problem_id))
    return True
