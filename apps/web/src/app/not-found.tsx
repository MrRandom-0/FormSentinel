import Link from "next/link";
export default function NotFound() {
  return (
    <div className="container page">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p className="lead">The page may have moved or the address is incomplete.</p>
      <Link className="button" href="/">
        Return home
      </Link>
    </div>
  );
}
