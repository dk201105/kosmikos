// Checks that an uploaded file's first bytes match the type the browser claimed.
const fs = require("fs");

const at = (buf, offset, str) => buf.toString("latin1", offset, offset + str.length) === str;
const isIsoMedia = (b) => at(b, 4, "ftyp");                        // mp4, mov, m4a
const isEbml = (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3; // webm
const isOgg = (b) => at(b, 0, "OggS");
const isMp3 = (b) => at(b, 0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
const isAac = (b) => at(b, 0, "ADIF") || (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) || at(b, 0, "ID3");
const isWav = (b) => at(b, 0, "RIFF") && at(b, 8, "WAVE");

const SIGNATURES = {
    "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/gif": (b) => at(b, 0, "GIF87a") || at(b, 0, "GIF89a"),
    "image/webp": (b) => at(b, 0, "RIFF") && at(b, 8, "WEBP"),
    "video/mp4": isIsoMedia,
    "video/quicktime": isIsoMedia,
    "video/webm": isEbml,
    "video/ogg": isOgg,
    "audio/mpeg": isMp3,
    "audio/mp3": isMp3,
    "audio/wav": isWav,
    "audio/x-wav": isWav,
    "audio/wave": isWav,
    "audio/ogg": isOgg,
    "audio/mp4": isIsoMedia,
    "audio/x-m4a": isIsoMedia,
    "audio/aac": isAac,
    "audio/webm": isEbml,
};

async function contentMatchesType(filePath, mimetype) {
    const check = SIGNATURES[mimetype];
    if (!check) return false;
    const fh = await fs.promises.open(filePath, "r");
    try {
        const head = Buffer.alloc(16);
        const { bytesRead } = await fh.read(head, 0, 16, 0);
        return bytesRead >= 4 && check(head);
    } finally {
        await fh.close();
    }
}

module.exports = { contentMatchesType, SIGNATURES };
