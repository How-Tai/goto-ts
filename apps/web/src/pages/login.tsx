import { useForm } from 'react-hook-form'
import { toast } from 'react-hot-toast'
import { useEffect, useRef, useState } from 'react'

// import { useUserData } from '@src/context/UserContext'
// import { errorToast, onErrorToast } from '@src/hooks/useErrorToast'
import { signIn } from 'next-auth/react'
import Head from 'next/head'
import Image from 'next/image'
import NextLink from 'next/link'
import { useRouter } from 'next/router'

import { LoginBody } from '@otog/contract'
import { Button } from '@otog/ui/button'
import { Form, FormField, FormItem, FormLabel } from '@otog/ui/form'
import { Input } from '@otog/ui/input'

import Logo from '../../public/logo512.png'
import { withSession } from '../api/server'
import { useUserContext } from '../context/user-context'
import { environment } from '../env'
import { loginMessages, loginOutcome } from '../api/login-feedback'

export const getServerSideProps = withSession(async ({ session }) => {
  if (session) {
    return {
      redirect: {
        destination: environment.OFFLINE_MODE ? '/contest' : '/problem',
        permanent: false,
      },
    }
  }
  return { props: {} }
})

export default function LoginPage() {
  const router = useRouter()
  const form = useForm<LoginBody>()
  const pending = useRef(false)
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isSigningIn, setSigningIn] = useState(false)
  useEffect(() => () => {
    if (slowTimer.current !== null) clearTimeout(slowTimer.current)
  }, [])

  const { clearCache } = useUserContext()
  const onSubmit = form.handleSubmit(async (values) => {
    if (pending.current) return
    pending.current = true
    setSigningIn(true)
    const toastId = toast.loading(loginMessages.pending)
    slowTimer.current = setTimeout(() => {
      toast.loading(loginMessages.slow, { id: toastId })
    }, 3000)
    try {
      const response = await signIn('otog', {
        username: values.username,
        password: values.password,
        redirect: false,
      })
      const outcome = loginOutcome(response)
      if (outcome !== 'success') {
        toast.error(loginMessages[outcome], { id: toastId })
        return
      }
      toast.success('ลงชื่อเข้าใช้สำเร็จ !', { id: toastId })
      clearCache()
      router.replace(environment.OFFLINE_MODE ? '/contest' : '/problem')
    } catch (e: unknown) {
      toast.error(loginMessages.unavailable, { id: toastId })
    } finally {
      if (slowTimer.current !== null) clearTimeout(slowTimer.current)
      slowTimer.current = null
      pending.current = false
      setSigningIn(false)
    }
  })
  return (
    <main className="container flex-1">
      <Head>
        <title>Login | OTOG</title>
      </Head>
      <Form {...form}>
        <form
          id="content"
          onSubmit={onSubmit}
          aria-busy={isSigningIn}
          className="mx-auto my-8 max-w-[300px] rounded-2xl border border-border p-5 shadow-md"
        >
          <div className="flex flex-col gap-4">
            <h1 className="sr-only">เข้าสู่ระบบ</h1>
            <Image
              src={Logo}
              className="mx-auto w-[100px] my-4"
              alt="otog logo"
            />
            <FormField
              control={form.control}
              name="username"
              defaultValue=""
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ชื่อผู้ใช้</FormLabel>
                  <Input
                    {...field}
                    disabled={isSigningIn}
                    placeholder="ชื่อผู้ใช้"
                    autoFocus
                    required
                  />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              defaultValue=""
              render={({ field }) => (
                <FormItem>
                  <FormLabel>รหัสผ่าน</FormLabel>
                  <Input
                    {...field}
                    disabled={isSigningIn}
                    type="password"
                    placeholder="รหัสผ่าน"
                    required
                  />
                </FormItem>
              )}
            />
            <Button type="submit" className="mt-5" disabled={isSigningIn}>
              {isSigningIn ? 'กำลังลงชื่อเข้าใช้...' : 'เข้าสู่ระบบ'}
            </Button>
            {/* {session ? (
              <Button onClick={() => signOut()}>Sign out here</Button>
            ) : (
              <Button onClick={() => signIn('google')} leftIcon={<FaGoogle />}>
                ลงชื่อเข้าใช้ด้วย Google
              </Button>
            )} */}
            {!environment.OFFLINE_MODE && (
              <>
                <hr />
                <Button asChild variant="secondary">
                  <NextLink href="/register">ลงทะเบียน</NextLink>
                </Button>
              </>
            )}
          </div>
        </form>
      </Form>
    </main>
  )
}
