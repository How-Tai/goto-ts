-- Read-only operational metadata for the existing admin grading endpoint.
-- Binary tokens, digests and executable contents stay private to the graders.
GRANT SELECT ("submissionId",state) ON "otogCompiledArtifact" TO otog_api_runtime;
GRANT SELECT ("workerId",enabled,"cpuId","startedAt","lastHeartbeat") ON "otogCompilerState" TO otog_api_runtime;
