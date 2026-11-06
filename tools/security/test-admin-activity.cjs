// Invoked by the real HTTP/PostgreSQL catalog fixture, never production.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')

module.exports = async function testAdminActivity({ db, base, token, contest, checks }) {
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/otog_cf_catalog_test')
  async function request(viewer, route, method = 'GET', data) {
    const response = await fetch(base + route, { method, headers: {
      ...(viewer ? {authorization:'Bearer '+token(viewer)} : {}),
      ...(data ? {'content-type':'application/json'} : {}),
    }, body: data ? JSON.stringify(data) : undefined })
    return { status:response.status, body:await response.json(), cache:response.headers.get('cache-control') }
  }
  await db.user.create({data:{id:4,username:'privacy-admin-4',showName:'Privacy admin 4',password:'fixture-unused',role:'admin',showInLeaderboard:false}})
  await db.refreshToken.create({data:{id:'catalog-rid-4',jwtId:'catalog-4',userId:4,used:false,expiryDate:new Date(Date.now()+600000)}})
  const problem = await db.problem.create({data:{name:'Privacy fixture',score:100,timeLimit:1000,memoryLimit:64,show:true}})
  async function solved(userId, contestId) {
    return db.submission.create({data:{userId,problemId:problem.id,contestId,language:'cpp',status:'accept',public:true,sourceCode:userId===1?'ADMIN_ONLY_SOURCE_FIXTURE':'NORMAL_PUBLIC_SOURCE_FIXTURE',submissionResult:{create:{result:'P',score:100,timeUsed:1,memUsed:1024}}}})
  }
  const admin = await solved(1), normal = await solved(3)
  const historyContest = await db.contest.create({data:{name:'Privacy history fixture',mode:'rated',gradingMode:'classic',scoreboardPolicy:'DURING_CONTEST',timeStart:new Date(Date.now()-7200000),timeEnd:new Date(Date.now()-3600000)}})
  await db.contestProblem.create({data:{contestId:historyContest.id,problemId:problem.id}})
  await db.userContest.create({data:{contestId:historyContest.id,userId:1,rank:1,ratingAfterUpdate:1500}})
  const contestSubmission = await solved(1,historyContest.id)
  await db.contestScore.create({data:{contestId:historyContest.id,userId:1,problemId:problem.id,score:100,contestScoreHistory:{create:{submissionId:contestSubmission.id,score:100}}}})

  for (const viewer of [undefined,2]) {
    for (const route of [
      '/submission/user/1','/submission?userId=1',
      '/user/1/passed-problems?sortBy=solvedDate',
      `/submission/${admin.id}`, `/submission/${admin.id}/code`,
      `/submission/${admin.id}/progress`,
      `/contest/${historyContest.id}/scoreHistory/1/`,
    ]) assert.equal((await request(viewer,route)).status,404,`${viewer} ${route}`)
    if (viewer) assert.equal((await request(viewer,`/submission/user/1/problem/${problem.id}`)).status,404)
    const profile = await request(viewer,'/user/1/profile')
    assert.equal(profile.status,200)
    assert.equal(profile.body.id,1)
    assert.deepEqual(profile.body.userContest,[])
    assert(profile.cache.includes('no-store'))
    const list = await request(viewer,'/submission')
    assert.equal(list.status,200)
    assert(list.body.some(row=>row.id===normal.id))
    assert(list.body.every(row=>row.userId!==1 && row.userId!==4))
    const progress = await request(viewer,'/submission/progress?ids='+encodeURIComponent(JSON.stringify([admin.id,normal.id])))
    assert.equal(progress.status,200)
    assert.deepEqual(progress.body.map(row=>row.id),[normal.id])
  }
  checks.push('Guests and ordinary users cannot read admin activity through profile history, lists, guessed IDs, shared source, score history or batch progress')

  for (const viewer of [1,4]) {
    const submissions = await request(viewer,'/submission/user/1')
    assert.equal(submissions.status,200)
    assert(submissions.body.some(row=>row.id===admin.id))
    assert(submissions.cache.includes('no-store'))
    const passed = await request(viewer,'/user/1/passed-problems?sortBy=id')
    assert.equal(passed.status,200)
    assert(passed.body.some(row=>row.id===problem.id))
    const code = await request(viewer,`/submission/${admin.id}/code`)
    assert.equal(code.status,200)
    assert.equal(code.body.sourceCode,'ADMIN_ONLY_SOURCE_FIXTURE')
    const profile = await request(viewer,'/user/1/profile')
    assert(profile.body.userContest.some(row=>row.contest.id===historyContest.id))
    assert.equal((await request(viewer,`/contest/${historyContest.id}/scoreHistory/1/`)).status,200)
  }
  checks.push('The admin owner and another admin retain activity, source, solved-problem and rated-history access')

  for (const visible of [false,true]) {
    assert.equal((await request(3,'/user/3/leaderboard-visibility','PATCH',{showInLeaderboard:visible})).status,200)
    const board = await request(undefined,'/user/leaderboard?limit=100&skip=0')
    assert.equal(board.body.data.some(row=>row.id===3),visible)
    assert.equal((await request(undefined,'/submission/user/3')).status,200)
    const passed = await request(undefined,'/user/3/passed-problems?sortBy=id')
    assert.equal(passed.status,200)
    assert(passed.body.some(row=>row.id===problem.id))
    assert.equal((await request(undefined,`/submission/${normal.id}/code`)).status,200)
  }
  assert.equal((await request(2,'/user/3/leaderboard-visibility','PATCH',{showInLeaderboard:false})).status,403)
  await request(1,'/user/1/leaderboard-visibility','PATCH',{showInLeaderboard:false})
  const hiddenAdminBoard = await request(undefined,'/user/leaderboard?limit=100&skip=0&showAll=true')
  assert(!hiddenAdminBoard.body.data.some(row=>row.id===1))
  const fullBoard = await request(4,'/user/leaderboard?limit=100&skip=0&showAll=true')
  assert(fullBoard.body.data.some(row=>row.id===1))
  checks.push('Leaderboard toggles still affect ranking only, hidden ordinary activity stays public, and only owner/admin can change preferences')

  await db.user.update({where:{id:3},data:{role:'admin'}})
  assert.equal((await request(2,'/submission/user/3')).status,404)
  assert.equal((await request(2,`/submission/${normal.id}/code`)).status,404)
  await db.user.update({where:{id:3},data:{role:'user'}})
  assert.equal((await request(2,'/submission/user/3')).status,200)
  checks.push('Changes to the target account role take effect immediately')

  const cfProblem = await db.cfProblem.findFirst({where:{contestId:contest.id},orderBy:{id:'asc'}})
  assert(cfProblem)
  const cfAdmin = await db.submission.create({data:{userId:1,problemId:cfProblem.problemId,contestId:contest.id,language:'cpp',status:'accept',sourceCode:'ADMIN_ONLY_CF_SOURCE_FIXTURE',cfRun:{create:{cfProblemId:cfProblem.id,kind:'contest',phase:'pretest',plan:{config:cfProblem.config},verified:true,preOutcome:{verdict:'accepted'},outcome:{verdict:'accepted'},requestId:'privacy:'+randomUUID()}}}})
  await db.cfContest.update({where:{contestId:contest.id},data:{phase:'final'}})
  assert.equal((await request(2,`/codeforces/${contest.id}/source/${cfAdmin.id}`)).status,404)
  const publicRuns = await request(2,`/codeforces/${contest.id}/submissions`)
  assert.equal(publicRuns.status,200)
  assert(!publicRuns.body.some(row=>row.id===cfAdmin.id))
  for (const viewer of [1,4]) {
    const code = await request(viewer,`/codeforces/${contest.id}/source/${cfAdmin.id}`)
    assert.equal(code.status,200)
    assert.equal(code.body.sourceCode,'ADMIN_ONLY_CF_SOURCE_FIXTURE')
    const runs = await request(viewer,`/codeforces/${contest.id}/submissions`)
    assert(runs.body.some(row=>row.id===cfAdmin.id))
  }
  await db.cfContest.update({where:{contestId:contest.id},data:{phase:'scheduled'}})
  const hack = await request(2,`/codeforces/${contest.id}/hack`,'POST',{targetId:cfAdmin.id,input:'1\n',requestId:randomUUID()})
  assert.equal(hack.status,400)
  checks.push('CF submission/source views and hack targets honor admin activity privacy, including after final results')
}
