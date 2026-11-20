import assert from "node:assert/strict";
import { isPublicIpv4 } from "../src/lib/plugins/provider-runtime";

const blocked = [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
];

const allowed = ["1.1.1.1", "8.8.8.8", "93.184.216.34"];

for (const address of blocked) {
    assert.equal(isPublicIpv4(address), false, `${address} must be blocked`);
}
for (const address of allowed) {
    assert.equal(isPublicIpv4(address), true, `${address} must be allowed`);
}

console.info(`Passed IPv4 SSRF regression checks (${blocked.length + allowed.length} cases).`);
