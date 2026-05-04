import {
  UNSPLASH_HOMEPAGE,
  getPhoto,
  getRandomPhoto,
  type UnsplashPhoto,
} from "../lib/unsplash";

interface CommonProps {
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  showCredit?: boolean;
}

type Props = CommonProps & ({ id: string } | { query: string });

// Server component. Fetches at build time (static export), so the image
// URL + credit are baked into the HTML.
export async function UnsplashImage(props: Props) {
  const photo: UnsplashPhoto | null =
    "id" in props
      ? await getPhoto(props.id)
      : await getRandomPhoto(props.query);
  if (!photo) return null;

  const { width, height, className, style, showCredit = true } = props;

  return (
    <figure style={{ margin: 0 }} className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={photo.alt}
        width={width ?? photo.width}
        height={height ?? photo.height}
        loading="lazy"
        decoding="async"
        style={{ display: "block", maxWidth: "100%", height: "auto", ...style }}
      />
      {showCredit ? (
        <figcaption style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          Photo by{" "}
          <a
            href={photo.credit.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {photo.credit.name}
          </a>{" "}
          on{" "}
          <a href={UNSPLASH_HOMEPAGE} target="_blank" rel="noopener noreferrer">
            Unsplash
          </a>
        </figcaption>
      ) : null}
    </figure>
  );
}
