/**
 * Internal dependencies.
 */
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./";
import { useToast } from "./hooks";

const formatToastText = (value: unknown) => {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "Something went wrong.";
  }
};

export const Toaster = () => {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        const descriptionText = formatToastText(description);
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {descriptionText ? <ToastDescription>{descriptionText}</ToastDescription> : null}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
};
