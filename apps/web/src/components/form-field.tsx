import type { InputHTMLAttributes } from "react";

type FormFieldProps = {
  label: string;
} & InputHTMLAttributes<HTMLInputElement>;

export function FormField({ label, id, ...inputProps }: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1" htmlFor={id}>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input
        id={id}
        {...inputProps}
        className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      />
    </label>
  );
}
