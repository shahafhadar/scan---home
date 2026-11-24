/** The app mark: a barcode over a "got it" bar, same as the home-screen icon. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#166534" />
      {[7, 9.5, 11, 14, 16, 17.5, 20.5, 22, 24].map((x, i) => (
        <rect key={x} x={x} y="8" width={i % 3 === 0 ? 1.8 : 1} height="11" fill="#fff" />
      ))}
      <rect x="7" y="22" width="18" height="2.4" rx="1.2" fill="#bbf7d0" />
    </svg>
  );
}
