export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-4xl font-bold">LivePulse</h1>
      <p className="text-slate-600">Live audience engagement — coming soon.</p>
      <div className="flex gap-3">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="rounded bg-slate-300 px-4 py-2 text-slate-600"
        >
          Create session
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="rounded bg-slate-300 px-4 py-2 text-slate-600"
        >
          Join session
        </button>
      </div>
      <p className="text-sm text-slate-500">Available in a later release</p>
    </main>
  )
}
