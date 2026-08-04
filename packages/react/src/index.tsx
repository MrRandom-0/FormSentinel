import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type FormHTMLAttributes,
  type ReactNode,
} from "react";
import {
  FormSentinelClient,
  type FormSentinelClientOptions,
  type SubmissionSuccess,
  type SubmitOptions,
} from "@formsentinel/sdk";
export type SubmissionState = "idle" | "pending" | "success" | "error";
export interface UseFormSentinelOptions extends FormSentinelClientOptions {
  onSuccess?: (result: SubmissionSuccess) => void;
  onError?: (error: unknown) => void;
  conversionTracking?: boolean;
}
export function useFormSentinel(options: UseFormSentinelOptions) {
  const client = useRef(new FormSentinelClient(options));
  const active = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const [state, setState] = useState<SubmissionState>("idle");
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<SubmissionSuccess | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const submit = useCallback(
    async (
      fields: Readonly<Record<string, string | number | boolean>> | FormData,
      submitOptions: SubmitOptions = {},
    ) => {
      if (pending.current) throw new Error("submission_in_progress");
      pending.current = true;
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      setState("pending");
      setError(null);
      setResult(null);
      const requestId = submitOptions.requestId ?? crypto.randomUUID();
      const idempotencyKey = submitOptions.idempotencyKey ?? requestId;
      try {
        const response = await client.current.submit(fields, {
          ...submitOptions,
          requestId,
          idempotencyKey,
          signal: submitOptions.signal
            ? AbortSignal.any([submitOptions.signal, controller.signal])
            : controller.signal,
        });
        setResult(response);
        setState("success");
        options.onSuccess?.(response);
        return response;
      } catch (value) {
        if (!controller.signal.aborted) {
          setError(value);
          setState("error");
          options.onError?.(value);
        }
        throw value;
      } finally {
        if (active.current === controller) active.current = null;
        pending.current = false;
      }
    },
    [options],
  );
  const reset = useCallback(() => {
    active.current?.abort();
    setState("idle");
    setError(null);
    setResult(null);
  }, []);
  return {
    state,
    pending: state === "pending",
    error,
    result,
    submit,
    reset,
    abort: () => active.current?.abort(),
    conversionTracking: options.conversionTracking === true,
  };
}
export interface FormSentinelFormProps extends Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "onSubmit"
> {
  client: UseFormSentinelOptions;
  children: ReactNode;
  successMessage?: string;
  errorMessage?: string;
  onSubmitFields?: (
    data: FormData,
  ) => FormData | Readonly<Record<string, string | number | boolean>>;
}
export function FormSentinelForm({
  client,
  children,
  successMessage = "Your form was submitted.",
  errorMessage = "The form could not be submitted. Please try again.",
  onSubmitFields,
  ...props
}: FormSentinelFormProps) {
  const form = useFormSentinel(client);
  const status = useRef<HTMLParagraphElement>(null);
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.pending) return;
    const data = new FormData(event.currentTarget);
    try {
      await form.submit(onSubmitFields?.(data) ?? data);
    } catch {
      status.current?.focus();
    }
  };
  useEffect(() => {
    if (form.state === "success" || form.state === "error") status.current?.focus();
  }, [form.state]);
  return (
    <form {...props} aria-busy={form.pending} onSubmit={handleSubmit}>
      <fieldset disabled={form.pending}>{children}</fieldset>
      <p ref={status} role="status" aria-live="polite" tabIndex={-1}>
        {form.pending
          ? "Submitting…"
          : form.state === "success"
            ? successMessage
            : form.state === "error"
              ? errorMessage
              : ""}
      </p>
    </form>
  );
}
export { FormSentinelClient, FormSentinelError } from "@formsentinel/sdk";
