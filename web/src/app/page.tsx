import Link from 'next/link'

const linkClass =
  'rounded bg-blue-700 px-4 py-2 font-medium text-white focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700'

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-4xl font-bold">LivePulse</h1>
      <p className="text-slate-700">Live audience engagement for your next session.</p>
      <div className="flex gap-3">
        <Link href="/create" className={linkClass}>
          Create a session
        </Link>
        <Link href="/join" className={linkClass}>
          Join a session
        </Link>
      </div>
    </main>
  )
}
