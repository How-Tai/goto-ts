import { useState } from 'react'
import type { ReactNode } from 'react'

export function StatementLanguageSelect({
  value,
  onChange,
}: {
  value: 'th' | 'en'
  onChange: (value: 'th' | 'en') => void
}) {
  return (
    <select
      aria-label="Statement language"
      className="rounded border bg-background px-2 py-1 text-sm text-foreground"
      value={value}
      onChange={(event) => onChange(event.target.value as 'th' | 'en')}
    >
      <option value="th">ไทย</option>
      <option value="en">English</option>
    </select>
  )
}

export function StatementViewer({
  url,
  title,
  children,
}: {
  url: string
  title: string
  children?: ReactNode
}) {
  const [language, setLanguage] = useState<'th' | 'en'>('th')
  const selected = `${url}${url.includes('?') ? '&' : '?'}lang=${language}`
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <StatementLanguageSelect value={language} onChange={setLanguage} />
        <a
          className="rounded border px-3 py-2"
          href={selected}
          target="_blank"
          rel="noreferrer"
        >
          Open statement PDF
        </a>
        {children}
      </div>
      <iframe
        className="mt-4 h-[65vh] w-full rounded border"
        title={title}
        src={selected}
      />
    </>
  )
}
