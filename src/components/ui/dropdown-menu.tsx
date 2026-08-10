import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronRight } from "lucide-react"

const DropdownMenuContext = React.createContext<{
  open: boolean
  setOpen: (open: boolean) => void
}>({ open: false, setOpen: () => {} })

function DropdownMenu({
  children,
  open: controlledOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<"div"> & {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const setOpen = React.useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalOpen(value)
      onOpenChange?.(value)
    },
    [isControlled, onOpenChange]
  )

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div data-slot="dropdown-menu" className="relative inline-block" {...props}>
        {children}
      </div>
    </DropdownMenuContext.Provider>
  )
}

function DropdownMenuTrigger({
  children,
  className,
  ...props
}: React.ComponentProps<"button">) {
  const { setOpen } = React.useContext(DropdownMenuContext)
  return (
    <button
      type="button"
      data-slot="dropdown-menu-trigger"
      onClick={() => setOpen(true)}
      className={className}
      {...props}
    >
      {children}
    </button>
  )
}

function DropdownMenuContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { open, setOpen } = React.useContext(DropdownMenuContext)

  React.useEffect(() => {
    if (!open) return
    const handleClickOutside = () => setOpen(false)
    document.addEventListener("click", handleClickOutside)
    return () => document.removeEventListener("click", handleClickOutside)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div
      data-slot="dropdown-menu-content"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "bg-popover text-popover-foreground absolute right-0 z-50 mt-1 min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-md",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<"div">) {
  return <div data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { setOpen } = React.useContext(DropdownMenuContext)
  return (
    <div
      data-slot="dropdown-menu-item"
      onClick={() => setOpen(false)}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dropdown-menu-label"
      className={cn("px-2 py-1.5 text-sm font-medium", className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dropdown-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn("text-muted-foreground ml-auto text-xs tracking-widest", className)}
      {...props}
    />
  )
}

function DropdownMenuSub({
  children,
  ...props
}: React.ComponentProps<"div">) {
  const [open, setOpen] = React.useState(false)
  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div data-slot="dropdown-menu-sub" className="relative" {...props}>
        {children}
      </div>
    </DropdownMenuContext.Provider>
  )
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { setOpen } = React.useContext(DropdownMenuContext)
  return (
    <div
      data-slot="dropdown-menu-sub-trigger"
      onClick={() => setOpen(true)}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-4" />
    </div>
  )
}

function DropdownMenuSubContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { open, setOpen } = React.useContext(DropdownMenuContext)

  React.useEffect(() => {
    if (!open) return
    const handleClickOutside = () => setOpen(false)
    document.addEventListener("click", handleClickOutside)
    return () => document.removeEventListener("click", handleClickOutside)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div
      data-slot="dropdown-menu-sub-content"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "bg-popover text-popover-foreground absolute left-full top-0 z-50 ml-1 min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-lg",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}