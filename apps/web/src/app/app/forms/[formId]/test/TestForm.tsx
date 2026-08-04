"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";

type Result = {
  success?: boolean;
  submission_id?: string;
  request_id?: string;
  message?: string;
  error?: string | { code: string; message: string; fields?: Record<string, string> };
};
type Values = Record<string, string | number | boolean>;

export function TestForm({
  endpoint,
  fields,
}: {
  endpoint: string;
  fields: readonly { name: string; type: string; required: boolean }[];
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>();
  const [result, setResult] = useState<Result | null>(null);
  async function submit(values: Values) {
    setResult(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      setResult((await response.json()) as Result);
    } catch {
      setResult({ error: "network_failure" });
    }
  }
  return (
    <>
      <form className="card" onSubmit={handleSubmit(submit)}>
        {fields.map((field) => {
          const errorId = `${field.name}-error`;
          const serverErrorId = `${field.name}-server-error`;
          const describedBy =
            [
              errors[field.name] ? errorId : undefined,
              result?.error && typeof result.error === "object" && result.error.fields?.[field.name]
                ? serverErrorId
                : undefined,
            ]
              .filter(Boolean)
              .join(" ") || undefined;
          const registration = register(field.name, {
            required: field.required ? `${field.name} is required` : false,
            valueAsNumber: field.type === "number",
          });
          const control =
            field.type === "textarea" ? (
              <textarea
                {...registration}
                required={field.required}
                aria-invalid={Boolean(errors[field.name])}
                aria-describedby={describedBy}
              />
            ) : (
              <input
                type={field.type}
                {...registration}
                required={field.required}
                aria-invalid={Boolean(errors[field.name])}
                aria-describedby={describedBy}
              />
            );
          return (
            <label
              className={`field${field.type === "checkbox" ? " checkbox-field" : ""}`}
              key={field.name}
            >
              <span>
                {field.name}
                {field.required ? " (required)" : " (optional)"}
              </span>
              {control}
              {errors[field.name] ? (
                <span id={errorId} role="alert">
                  {String(errors[field.name]?.message)}
                </span>
              ) : null}
              {result?.error &&
              typeof result.error === "object" &&
              result.error.fields?.[field.name] ? (
                <span id={serverErrorId} role="alert">
                  {result.error.fields[field.name]}
                </span>
              ) : null}
            </label>
          );
        })}
        <button className="button" disabled={isSubmitting}>
          {isSubmitting ? "Testing…" : "Run development test"}
        </button>
      </form>
      <div aria-live="polite">
        {result?.error ? (
          <p className="notice">
            Test failed: {typeof result.error === "string" ? result.error : result.error.message}
          </p>
        ) : null}
        {result?.success ? (
          <div className="notice">
            <strong>{result.message || "Submission accepted"}</strong>
            <p>Submission {result.submission_id} is durably queued for asynchronous processing.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
