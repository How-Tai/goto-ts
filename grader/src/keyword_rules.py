"""Basic case-sensitive identifiers; comments and quoted text are ignored."""
import re
from pathlib import Path


def code_without_comments_and_strings(source, language):
    python = language in ('py', 'python')
    code = source if python else re.sub(r'\\\r?\n', '', source)
    output = []
    i = 0
    while i < len(code):
        if (not python and code.startswith('//', i)) or (python and code[i] == '#'):
            end = code.find('\n', i)
            i = len(code) if end < 0 else end
            output.append(' ')
            continue
        if not python and code.startswith('/*', i):
            end = code.find('*/', i + 2)
            i = len(code) if end < 0 else end + 2
            output.append(' ')
            continue
        if not python and code.startswith('R"', i):
            raw = re.match(r'R"([^\s()\\]{0,16})\(', code[i:])
            if raw:
                ending = ')' + raw.group(1) + '"'
                end = code.find(ending, i + len(raw.group(0)))
                i = len(code) if end < 0 else end + len(ending)
                output.append(' ')
                continue
        quote = code[i]
        separator = not python and quote == "'" and i > 0 and i + 1 < len(code) and code[i - 1] in '0123456789' and code[i + 1] in '0123456789'
        if quote == '"' or quote == "'" and not separator:
            delimiter = quote * 3 if python and code.startswith(quote * 3, i) else quote
            i += len(delimiter)
            while i < len(code):
                if code[i] == '\\':
                    i += 2
                    continue
                if code.startswith(delimiter, i):
                    i += len(delimiter)
                    break
                i += 1
            output.append(' ')
            continue
        output.append(code[i])
        i += 1
    return ''.join(output)


def check_keywords(source, language, required, banned):
    code = code_without_comments_and_strings(source or '', language)
    def contains(word):
        pattern = r'(^|[^A-Za-z0-9_])' + r'\s*::\s*'.join(re.escape(part) for part in word.split('::')) + r'($|[^A-Za-z0-9_])'
        return re.search(pattern, code) is not None
    return {'missing': [word for word in required if not contains(word)],
            'banned': [word for word in banned if contains(word)]}


def policy_rejection(submission, conn):
    with conn.cursor() as cursor:
        cursor.execute('SELECT "requiredKeywords","bannedKeywords" FROM "otogProblemKeywordRules" WHERE "problemId"=%s', (submission.problemId,))
        rules = cursor.fetchone()
    conn.commit()
    if not rules or not (rules[0] or rules[1]):
        return None
    failed = check_keywords(submission.sourceCode, submission.language, *rules)
    if not (failed['missing'] or failed['banned']):
        return None
    # Preserve subtask layout for verdict details and best-subtask contest scoring.
    import subtask
    from DTO.result import ResultDTO, GroupResult
    from DTO.verdictTestcase import VerdictTestcase
    from constants.Enums import SubmissionStatus, VerdictStatus
    task_file = Path(submission.problemPath) / 'subtask.json'
    tasks = subtask.compile(task_file.read_text(encoding='utf-8') if task_file.exists() else submission.testcase)
    groups = [GroupResult(0, task.score, [VerdictTestcase(VerdictStatus.reject, 0, 0, 0) for _ in task.cases]) for task in tasks.subtasks]
    message = ['Keyword requirements failed:']
    if failed['missing']:
        message.append('Missing required keywords: ' + ', '.join(failed['missing']))
    if failed['banned']:
        message.append('Banned keywords found: ' + ', '.join(failed['banned']))
    symbols = ''.join('[' + '-' * len(task.cases) + ']' for task in tasks.subtasks)
    # The legacy summary column has a 255-character limit; detailed cases are preserved.
    return ResultDTO(submission.id, symbols if len(symbols) <= 255 else 'Wrong Answer', 0, 0, 0, '\n'.join(message), SubmissionStatus.reject, groups)
