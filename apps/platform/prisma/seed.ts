import { PrismaClient } from "@prisma/client";
import { mintApiKey, parseApiKey } from "@preflight/domain";
import { hashSecret } from "../src/crypto";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "harbor" },
    update: {},
    create: { name: "Harbor", slug: "harbor" },
  });

  const project = await prisma.project.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: "harbor-node" } },
    update: {},
    create: {
      organizationId: org.id,
      name: "Harbor Node",
      slug: "harbor-node",
    },
  });

  const plaintext = process.env.DEMO_API_KEY ?? mintApiKey().plaintext;
  const parsed = parseApiKey(plaintext);
  await prisma.apiKey.upsert({
    where: { prefix: parsed.prefix },
    update: { hash: await hashSecret(parsed.secret), revokedAt: null, name: "demo" },
    create: {
      organizationId: org.id,
      name: "demo",
      prefix: parsed.prefix,
      hash: await hashSecret(parsed.secret),
    },
  });

  console.log("seeded");
  console.log(`organization: ${org.slug} (${org.id})`);
  console.log(`project:      ${project.slug} (${project.id})`);
  console.log(`api key:      ${plaintext}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
