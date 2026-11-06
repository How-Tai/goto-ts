import localFont from 'next/font/local'

// Keep the deployed font subsets locally so production builds do not depend on Google.
export const inter = { style: { fontFamily: 'OtogInter, Arial, sans-serif' } }

// export const sarabun = Sarabun({
//   weight: ['400', '500', '600', '700'],
//   subsets: ['latin'],
//   variable: '--font-sarabun',
// })

export const sarabun = localFont({
  src: [
    {
      weight: '400',
      style: 'normal',
      path: './Sarabun-Regular.ttf',
    },
    {
      weight: '500',
      style: 'normal',
      path: './Sarabun-Medium.ttf',
    },
    {
      weight: '600',
      style: 'normal',
      path: './Sarabun-SemiBold.ttf',
    },
    {
      weight: '700',
      style: 'normal',
      path: './Sarabun-Bold.ttf',
    },
  ],
  variable: '--font-sarabun',
})

export const notosans = { style: { fontFamily: 'OtogNotoSansThai, Arial, sans-serif' } }
