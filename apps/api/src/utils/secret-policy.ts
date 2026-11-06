export function strongSecret(value: string) {
  return value.length >= 32 && new Set(value).size >= 12 &&
    !/changeme|replace|your[-_ ]?secret|example|secretkey|supersecret|jwt_secret/i.test(value)
}
