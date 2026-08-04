"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container page">
      <h1>Something went wrong</h1>
      <p>Nothing was submitted. Try the operation again.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
