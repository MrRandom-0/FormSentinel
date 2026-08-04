import { Phase3FeaturePage } from "../../../components/Phase3FeaturePage";
export const metadata = { title: "Schema drift" };
export default function SchemaDriftPage() {
  return (
    <Phase3FeaturePage
      title="Schema drift"
      description="Review deterministic additions, removals, rename candidates, type, validation, file, and nesting changes."
      status="preview"
      evidence={[
        "Accept and rollback create new immutable schema versions.",
        "Map, reject, and exact-fingerprint temporary ignore decisions preserve history and use optimistic versions.",
      ]}
      empty="No open drift observations."
    />
  );
}
