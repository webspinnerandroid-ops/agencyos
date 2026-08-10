import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronDown, Check } from "lucide-react"

interface SelectContextValue {
  value: string
  open: boolean
  setOpen: (open: boolean) => void
  setValue: (value: string) => void
}

const SelectContext = React.createContext<SelectContextValue>({
  value: "",
  open: false,
  setOpen: () => {},
  setValue: () => {},
})

function Select({
  defaultValue,
  value: controlledValue,
  onValueChange,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
}) {
  const [internalValue, setInternalValue] = React.useState(defaultValue || "")
  const [open, setOpen] = React.useState(false)
  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : internalValue

  const setValue = React.useCallback(
    (newValue: string) => {
      if (!isControlled) setInternalValue(newValue)
      onValueChange?.(newValue)
      setOpen(false)
    },
    [isControlled, onValueChange]
  )

  return (
    <SelectContext.Provider value={{ value, open, setOpen, setValue }}>
      <div data-slot="select" className="relative" {...props}>
        {children}
      </div>
    </SelectContext.Provider>
  )
}

function SelectGroup({
  ...props
}: React.ComponentProps<"div">) {
  return <div data-slot="select-group" {...props} />
}

function SelectValue({
  className,
  placeholder,
  children,
}: {
  className?: string
  placeholder?: string
  children?: React.ReactNode
}) {
  const { value } = React.useContext(SelectContext)
  return (
    <span
      data-slot="select-value"
      className={cn(
        value || children ? "" : "text-muted-foreground",
        className
      )}
    >
      {(children ?? value) || placeholder || "Select..."}
    </span>
  )
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  const { open, setOpen } = React.useContext(SelectContext)

  return (
    <button
      type="button"
      data-slot="select-trigger"
      onClick={() => setOpen(!open)}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 h-9 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown className="size-4 opacity-50" />
    </button>
  )
}

function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { open } = React.useContext(SelectContext)
  if (!open) return null

  return (
    <div
      data-slot="select-content"
      className={cn(
        "bg-popover text-popover-foreground absolute z-50 mt-1 max-h-60 min-w-[8rem] overflow-auto rounded-md border shadow-md",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<"div"> & { value: string }) {
  const { value: selectedValue, setValue } = React.useContext(SelectContext)
  const isSelected = selectedValue === value

  return (
    <div
      data-slot="select-item"
      onClick={() => setValue(value)}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
      {isSelected && (
        <span className="absolute right-2">
          <Check className="size-4" />
        </span>
      )}
    </div>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
}