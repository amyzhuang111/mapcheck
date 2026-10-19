import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-none border bg-clip-padding text-sm leading-[1.25] font-medium whitespace-nowrap shadow-none outline-none select-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-white bg-white text-black hover:bg-white",
        outline: "border-white bg-black text-white hover:bg-black",
        secondary: "border-white bg-black text-white hover:bg-black",
        ghost: "border-white bg-black text-white hover:bg-black",
        destructive: "border-white bg-white text-black hover:bg-white",
        link: "border-transparent bg-transparent text-white underline-offset-4 hover:underline",
      },
      size: {
        default: "px-4 py-2",
        xs: "px-4 py-2 text-xs",
        sm: "px-4 py-2 text-[0.8rem]",
        lg: "px-4 py-2",
        icon: "size-8 p-0",
        "icon-xs": "size-6 p-0",
        "icon-sm": "size-7 p-0",
        "icon-lg": "size-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
