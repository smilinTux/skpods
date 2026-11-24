export const cx = (...a: Array<string | false | null | undefined | 0>) => a.filter(Boolean).join(" ")
