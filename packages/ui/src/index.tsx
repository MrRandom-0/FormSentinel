import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren } from "react";
export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props} />;
}
export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...props} />;
}
export function EmptyState({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <section className="empty-state" aria-labelledby="empty-title">
      <h2 id="empty-title">{title}</h2>
      {children}
    </section>
  );
}
export function Field({
  label,
  error,
  children,
}: PropsWithChildren<{ label: string; error?: string }>) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? (
        <span role="alert" className="field-error">
          {error}
        </span>
      ) : null}
    </label>
  );
}
