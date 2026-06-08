// SendVCard: the backend mails the vCard the UI wrote; it makes nothing of its own.

import { beforeEach, describe, expect, it } from "vitest";
import { MalformedObject, SendVCard, SendVCardResponse } from "$module/contacts/v1";
import { ACCOUNT, install_fake_soba, type FakeSoba } from "../test/soba";

// stand-ins for the base module's classes, which the Mutator hands to process()
class Message {
    uuid = "";
    from: unknown;
    to: unknown;
    subject = "";
    bodyText = "";
    attachments: Attachment[] = [];
    genUuid() {
        this.uuid = "{generated}";
    }
}
class Attachment {
    constructor(public init: { name: string; type: string; blobs: ArrayBuffer[] }) {}
}
const MAIL = { Message, MessageAttachment: Attachment };

const CARD = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Şükrü\r\nEND:VCARD\r\n";

let soba: FakeSoba;
beforeEach(async () => {
    soba = await install_fake_soba();
});

const send = (content: ConstructorParameters<typeof SendVCard>[0]) => {
    const request = new SendVCard(content);
    return soba.run<SendVCardResponse>({ process: () => request.process(MAIL) });
};

describe("SendVCard", () => {
    it("mails the UI's vCard as an attachment to every address it gives", () => {
        const response = send({
            to: ["a@example.com", " b@example.com ", ""],
            filename: "Şükrü.vcf",
            vcard: CARD,
            subject: "Contact: Şükrü",
            text: "The contact card is attached.",
        });

        expect(response?.to).toEqual(["a@example.com", "b@example.com"]);
        expect(soba.sent).toHaveLength(1);
        const m = soba.sent[0] as Message;
        expect(m.uuid).toBe("{generated}");
        expect(m.from).toEqual([{ address: ACCOUNT }]);
        expect(m.to).toEqual([{ address: "a@example.com" }, { address: "b@example.com" }]);
        expect(m.subject).toBe("Contact: Şükrü");
        expect(m.bodyText).toBe("The contact card is attached.");

        expect(m.attachments).toHaveLength(1);
        const { name, type, blobs } = m.attachments[0].init;
        expect(name).toBe("Şükrü.vcf");
        expect(type).toBe("text/vcard");
        expect(blobs[0]).toBeInstanceOf(ArrayBuffer);
        expect(new TextDecoder().decode(blobs[0])).toBe(CARD);
    });

    it("fills in a subject, a text and a file name the UI left out", () => {
        send({ to: "a@example.com", vcard: CARD });
        const m = soba.sent[0] as Message;
        expect(m.subject).toBe("Contacts");
        expect(m.bodyText).toBe("Attached: contacts.vcf");
        expect(m.attachments[0].init.name).toBe("contacts.vcf");
    });

    it("refuses a request without an address or a vCard", () => {
        expect(() => new SendVCard({ to: [" "], vcard: CARD })).toThrow(MalformedObject);
        expect(() => new SendVCard({ to: ["a@example.com"], vcard: " " })).toThrow(
            /^Missing SendVCard\.vcard$/,
        );
        expect(soba.sent).toHaveLength(0);
    });
});
