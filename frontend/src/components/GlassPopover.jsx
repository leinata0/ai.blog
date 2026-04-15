export default function GlassPopover({ children, className = '', ...props }) {
  return (
    <div className={`glass-popover ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}
