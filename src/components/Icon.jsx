/** Material Symbols Outlined icon (font loaded in index.html). */
export default function Icon({ name, size, className = '', style, ...rest }) {
  return (
    <span aria-hidden="true" className={`ms ${className}`} style={size ? { fontSize: size, ...style } : style} {...rest}>
      {name}
    </span>
  );
}
