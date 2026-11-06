// import { ConfirmModalProvider } from '@src/context/ConfirmContext'
// import { useAnalytics } from '@src/hooks/useAnalytics'
import { ReactElement, ReactNode, useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'

import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from '@tanstack/react-query'
import { ClickToComponent } from 'click-to-react-component'
import dayjs from 'dayjs'
import 'dayjs/locale/th'
import buddhistEra from 'dayjs/plugin/buddhistEra'
import { NextComponentType, NextPageContext } from 'next'
import { Session } from 'next-auth'
import { SessionProvider } from 'next-auth/react'
import { AppProps } from 'next/app'
import dynamic from 'next/dynamic'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { NuqsAdapter } from 'nuqs/adapters/next/pages'

import { Button } from '@otog/ui/button'
import '@otog/ui/styles.css'
import { TooltipProvider } from '@otog/ui/tooltip'

import { backgroundFocusListener } from '../api/background-focus'
import { DeferredChat } from '../components/deferred-chat'
import { Footer } from '../components/footer'
import { Navbar } from '../components/navbar'
import { ThemeProvider } from '../components/theme-provider'
import { SocketProvider } from '../context/socket-context'
import { SubmissionUpdatesProvider } from '../context/submission-updates-context'
import { UserContextProvider } from '../context/user-context'
import { inter, notosans, sarabun } from '../fonts'
import '../fonts/self-hosted/self-hosted.css'
import { ProblemPageOverlapProvider } from '../hooks/use-problem-page-overlap'
import '../styles/nprogress.css'

dayjs.locale('th')
dayjs.extend(buddhistEra)

const ProgressBar = dynamic(() => import('./../components/progress-bar'), {
  ssr: false,
})

// if (OFFLINE_MODE) {
//   loader.config({
//     paths: {
//       vs: '/vs',
//     },
//   })
// }

export type NextPageWithLayout = NextComponentType<
  NextPageContext,
  any,
  any
> & {
  getLayout?: (page: ReactElement) => ReactNode
  footer?: boolean
}

type MyAppProps = AppProps<{
  //   errorData: ErrorToastOptions
  //   fallback: { [key: string]: string }
  session: Session
}> & {
  Component: NextPageWithLayout
}

export default function MyApp({ Component, pageProps }: MyAppProps) {
  const pathname = useRouter().pathname
  const cfArea =
    pathname.startsWith('/codeforces') ||
    pathname.startsWith('/admin/codeforces')
  const { session, ...props } = pageProps
  useEffect(() => {
    focusManager.setEventListener(backgroundFocusListener)
    return () => focusManager.setEventListener(() => () => {})
  }, [])

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { mutations: { throwOnError: false } },
      })
  )

  const getLayout = Component.getLayout ?? ((page) => page)

  //   useErrorToaster(errorData)
  //   useAnalytics()
  return (
    <>
      <Head>
        <meta
          name="description"
          content="Become a god of competitive programming. Code and create algorithms efficiently."
        />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/logo196.png" type="image/png" />
        <link rel="shortcut icon" href="/logo196.png" />
        <link rel="apple-touch-icon" href="/logoIOS.png" />
        <meta
          name="viewport"
          content="minimum-scale=1, initial-scale=1, width=device-width"
        />
      </Head>
      <style jsx global>{`
        :root {
          --font-inter: ${inter.style.fontFamily};
          --font-sarabun: ${sarabun.style.fontFamily};
          --font-notosans: ${notosans.style.fontFamily};
        }
      `}</style>
      <NuqsAdapter>
        <SessionProvider session={session}>
          <QueryClientProvider client={queryClient}>
            <UserContextProvider session={session}>
              <ProblemPageOverlapProvider>
                <SocketProvider>
                  <SubmissionUpdatesProvider>
                    <TooltipProvider delayDuration={0}>
                      <ThemeProvider
                        attribute="class"
                        defaultTheme="system"
                        enableSystem
                        disableTransitionOnChange
                      >
                        <div className="min-h-screen flex flex-col">
                          <SkipToMainContent />
                          <ProgressBar />
                          {!cfArea && <Navbar />}
                          {getLayout(<Component {...props} />)}
                          {!cfArea && <DeferredChat />}
                          {(Component.footer ?? true) && <Footer />}
                        </div>
                        <Toaster
                          position="bottom-center"
                          toastOptions={{
                            className: '!text-foreground !bg-background',
                          }}
                        />
                        <ClickToComponent />
                      </ThemeProvider>
                    </TooltipProvider>
                  </SubmissionUpdatesProvider>
                </SocketProvider>
              </ProblemPageOverlapProvider>
            </UserContextProvider>
          </QueryClientProvider>
        </SessionProvider>
      </NuqsAdapter>
    </>
  )
}

const SkipToMainContent = () => {
  return (
    <Button
      className="opacity-0 absolute left-4 top-4 focus-visible:opacity-100 focus-visible:z-50"
      asChild
    >
      <a href="#content">ข้ามไปยังเนื้อหาหลัก</a>
    </Button>
  )
}
