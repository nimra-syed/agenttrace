// A short payload renders inline. A long one collapses behind a native
// <details>/<summary>, closed by default, so a large input/output blob
// doesn't dominate the page before anyone's asked to see it. Plain
// semantic HTML, not a component library, keeps this dependency-free.
const INLINE_THRESHOLD = 200;

export function CollapsiblePayload({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  if (value == null) return null;

  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length === 0) return null;

  if (text.length <= INLINE_THRESHOLD) {
    return (
      <div className="text-xs">
        <span className="font-medium text-gray-500">{label}: </span>
        <span className="whitespace-pre-wrap break-words text-gray-700">
          {text}
        </span>
      </div>
    );
  }

  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium text-gray-500">
        {label} ({text.length.toLocaleString()} characters)
      </summary>
      <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-gray-700">
        {text}
      </pre>
    </details>
  );
}
