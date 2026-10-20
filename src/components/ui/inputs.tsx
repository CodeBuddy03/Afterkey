import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Form primitives. Every control has a visible label, optional description
 * ("why we ask") and an error slot wired with aria-describedby — required by
 * the UX/accessibility rules in the specification.
 */

let fieldCounter = 0;

export interface FieldProps {
  label: string;
  htmlFor?: string;
  description?: string;
  error?: string;
  required?: boolean;
  optionalHint?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, description, error, required, optionalHint, children, className }: FieldProps) {
  const autoId = React.useId();
  const id = htmlFor ?? autoId;
  const descId = `${id}-desc`;
  const errId = `${id}-err`;

  // Wire the label to its control: inject the id (when the control does not
  // define its own) and aria-describedby for the description/error slots.
  // Without this, every Field-wrapped input has an unassociated label —
  // invisible to screen readers and unclickable for pointer users.
  const describedBy = [description ? descId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  const wired = React.Children.map(children, (child) => wireControl(child, id, describedBy));

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-charcoal">
        {label}
        {required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
        {!required && optionalHint && <span className="ml-2 text-xs font-normal text-muted">Optional</span>}
      </label>
      {description && (
        <p id={descId} className="text-xs leading-5 text-muted">
          {description}
        </p>
      )}
      {wired}
      {error && (
        <p id={errId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL_TYPES = new Set(["input", "textarea", "select"]);
const CONTROL_DISPLAY_NAMES = new Set(["Input", "Textarea", "Select"]);

function isControlType(type: unknown): boolean {
  if (typeof type === "string") return CONTROL_TYPES.has(type);
  if ((typeof type === "function" || typeof type === "object") && type !== null && "displayName" in type) {
    return CONTROL_DISPLAY_NAMES.has(String((type as { displayName?: string }).displayName));
  }
  return false;
}

/** Recursively find the input-like control inside a Field's children and wire it. */
function wireControl(node: React.ReactNode, id: string, describedBy: string | undefined): React.ReactNode {
  if (Array.isArray(node)) return node.map((child) => wireControl(child, id, describedBy));
  if (!React.isValidElement(node)) return node;

  const props = node.props as { children?: React.ReactNode; id?: string };
  if (isControlType(node.type)) {
    return React.cloneElement(node as React.ReactElement<Record<string, unknown>>, {
      id: props.id ?? id,
      "aria-describedby": describedBy,
    });
  }
  if (props.children !== undefined) {
    return React.cloneElement(node as React.ReactElement<Record<string, unknown>>, {
      children: React.Children.map(props.children, (child) => wireControl(child, id, describedBy)),
    });
  }
  return node;
}

const CONTROL =
  "w-full rounded-lg border border-line-dark bg-surface px-3.5 py-2.5 text-sm text-charcoal placeholder:text-muted/70 " +
  "shadow-sm transition-colors focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15 " +
  "disabled:cursor-not-allowed disabled:bg-ivory-100 disabled:text-muted";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      data-interactive
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, invalid && "border-danger focus:border-danger focus:ring-danger/15", className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    data-interactive
    aria-invalid={invalid || undefined}
    className={cn(CONTROL, "min-h-[110px] resize-y leading-6", invalid && "border-danger", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(({ className, invalid, children, ...props }, ref) => (
  <select
    ref={ref}
    data-interactive
    aria-invalid={invalid || undefined}
    className={cn(CONTROL, "appearance-none bg-no-repeat pr-9", invalid && "border-danger", className)}
    style={{
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%235C6675' stroke-width='2'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")",
      backgroundPosition: "right 0.75rem center",
    }}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Checkbox({
  label,
  description,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; description?: React.ReactNode; error?: string }) {
  const id = React.useId();
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2.5">
        <input
          id={id}
          data-interactive
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-dark text-navy accent-navy focus:ring-navy/20"
          {...props}
        />
        <label htmlFor={id} className="text-sm leading-6 text-charcoal">
          {label}
        </label>
      </div>
      {description && <p className="pl-7 text-xs leading-5 text-muted">{description}</p>}
      {error && (
        <p role="alert" className="pl-7 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function RadioCards({
  name,
  value,
  onChange,
  options,
  columns = "sm:grid-cols-2",
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: ChoiceOption[];
  columns?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-3", columns)} role="radiogroup" aria-label={name}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-4 transition-colors",
              selected ? "border-navy ring-2 ring-navy/15" : "border-line-dark hover:border-navy-200",
              opt.disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={selected}
              disabled={opt.disabled}
              onChange={() => onChange(opt.value)}
              data-interactive
              className="mt-1 h-4 w-4 border-line-dark accent-navy"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-navy">{opt.label}</span>
              {opt.description && <span className="mt-0.5 block text-xs leading-5 text-muted">{opt.description}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Small helper to keep ids unique if a form renders many raw fields. */
export function useFieldId(prefix = "f"): string {
  const id = React.useId();
  fieldCounter += 1;
  return `${prefix}-${id}-${fieldCounter}`;
}
