// Labels of the values in a person's emails and phones. On the wire they are a map per
// list, value -> label (Person.labels); the edit form keeps them in an array parallel to
// the values instead, so editing a value doesn't detach its label.

export type LabelledKey = "emails" | "phones";

// what the form offers; "" is no label
export const LABEL_OPTIONS: Record<LabelledKey, string[]> = {
    emails: ["", "home", "work", "other"],
    phones: ["", "mobile", "home", "work", "fax", "other"],
};

export function label_text(label: string): string {
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : "No label";
}

/** The labels of `values`, in order, from a value -> label map. */
export function labels_of(values: string[], labels?: Record<string, string>): string[] {
    return values.map((v) => labels?.[v.trim()] ?? "");
}

/** The value -> label map of parallel `values` and `labels`, blanks left out. */
export function labels_map(values: string[], labels: string[]): Record<string, string> {
    const ret: Record<string, string> = {};
    values.forEach((v, i) => {
        const value = v.trim();
        const label = (labels[i] ?? "").trim();
        if (value && label) ret[value] = label;
    });
    return ret;
}
