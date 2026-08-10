import * as React from "react"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

function Toast({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "destructive"
}) {
  return (
    <div
      data-slot="toast"
      className={cn(
        "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all",
        variant === "destructive" &&
          "destructive group border-destructive bg-destructive text-destructive-foreground",
        className
      )}
      {...props}
    />
  )
}

function ToastAction({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      data-slot="toast-action"
      className={cn(
        "ring-offset-background hover:bg-secondary focus:ring-ring group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function ToastClose({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      data-slot="toast-close"
      className={cn(
        "text-foreground/50 hover:text-foreground absolute top-2 right-2 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 focus:opacity-100 focus:ring-2 focus:outline-hidden",
        className
      )}
      {...props}
    >
      <X className="size-4" />
    </button>
  )
}

function ToastTitle({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toast-title"
      className={cn("text-sm font-semibold", className)}
      {...props}
    />
  )
}

function ToastDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toast-description"
      className={cn("text-sm opacity-90", className)}
      {...props}
    />
  )
}

function ToastViewport({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toast-viewport"
      className={cn(
        "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
        className
      )}
      {...props}
    />
  )
}

function ToastProvider({ children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="toast-provider" {...props}>
      {children}
    </div>
  )
}

type ToastProps = React.ComponentProps<typeof Toast>
type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}