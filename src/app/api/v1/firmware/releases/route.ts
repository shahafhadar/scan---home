import { json } from "@/server/deviceAuth";
import { db } from "@/server/db";
import { MAX_IMAGE_BYTES, parseImageTag, requestOrigin, sha256Hex, verifyImage } from "@/server/firmware";

export const dynamic = "force-dynamic";

/**
 * Uploads a firmware release (firmware/tools/ota-release.sh).
 *
 * No account and no token: the signature is the authorisation. Only the
 * holder of the private signing key can produce an image this accepts, and an
 * image it accepts is exactly one a device would accept. Everything about the
 * release -- version, build, board, host -- is read from the tag inside the
 * signed bytes, never from the request.
 *
 * It always lands as a draft (rollout 0%). Publishing is a separate, deliberate
 * step (docs/firmware-ota.md).
 */
export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) return json({ error: "image is larger than an application slot" }, 413);

  const signatureHeader = request.headers.get("x-firmware-signature") ?? "";
  const signature = Buffer.from(signatureHeader, "base64");
  if (signature.length < 8 || signature.length > 80) return json({ error: "missing or malformed signature" }, 400);

  const image = Buffer.from(await request.arrayBuffer());
  if (image.length === 0) return json({ error: "empty image" }, 400);
  if (image.length > MAX_IMAGE_BYTES) return json({ error: "image is larger than an application slot" }, 413);

  if (!verifyImage(image, signature)) return json({ error: "signature does not verify" }, 400);

  const tag = parseImageTag(image);
  if (!tag) return json({ error: "image carries no valid SCANCART-IMAGE tag" }, 400);

  // An image talks to the host it was built for. Accepting one built for a
  // different server would hand its devices firmware that cannot reach home
  // -- the mix-up this check exists for is a development image on production.
  if (tag.host.toLowerCase() !== requestOrigin(request)) {
    return json({ error: `image was built for ${tag.host}, not this server` }, 400);
  }

  try {
    const { rows } = await db().query<{ id: string; rollout_percent: number }>(
      `INSERT INTO public.firmware_releases (version, build, hw, host, size, sha256, signature, image)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, rollout_percent`,
      [tag.version, tag.build, tag.hw, tag.host, image.length, sha256Hex(image), signature, image],
    );
    const row = rows[0]!;
    return json({ id: row.id, version: tag.version, build: tag.build, hw: tag.hw, rollout_percent: row.rollout_percent }, 201);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return json({ error: `${tag.version} for ${tag.build}/${tag.hw} already exists` }, 409);
    }
    throw error;
  }
}
