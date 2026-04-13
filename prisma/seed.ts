import { PrismaClient, DiscountType, SenderRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Starting Seed Process ---');

    // 1. CLEANUP (Optional: Clears existing data to prevent duplicates)
    await prisma.chatHistory.deleteMany();
    await prisma.userSession.deleteMany();
    await prisma.inventoryLog.deleteMany();
    await prisma.discount.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.merchant.deleteMany();

    console.log('Cleanup finished.');

    // 2. CREATE MERCHANTS
    const aura = await prisma.merchant.create({
        data: {
            storeName: 'Aura Boutique',
            shopifyDomain: 'aura-boutique.myshopify.com',
            whatsappBusinessId: 'waba_aura_123',
            phoneNumberId: '919000000001',
        },
    });

    const tech = await prisma.merchant.create({
        data: {
            storeName: 'TechVibe',
            shopifyDomain: 'techvibe-official.myshopify.com',
            whatsappBusinessId: 'waba_tech_456',
            phoneNumberId: '919000000002',
        },
    });

    const eco = await prisma.merchant.create({
        data: {
            storeName: 'EcoHome',
            shopifyDomain: 'ecohome-living.myshopify.com',
            whatsappBusinessId: 'waba_eco_789',
            phoneNumberId: '919000000003',
        },
    });

    console.log('Merchants created.');

    // 3. HELPER FOR PRODUCT GENERATION
    const createProducts = async (merchantId: number, category: string, count: number, prefix: string) => {
        for (let i = 1; i <= count; i++) {
            const product = await prisma.product.create({
                data: {
                    merchantId,
                    title: `${prefix} ${category} ${i}`,
                    description: `A premium ${prefix.toLowerCase()} ${category.toLowerCase()} designed for modern lifestyle. High quality materials used for durability and style.`,
                    category,
                    variants: {
                        create: [
                            { sku: `SKU-${prefix}-${i}-RED-S`, color: 'Red', size: 'S', price: 45.00 + i, currentStock: 10 + i },
                            { sku: `SKU-${prefix}-${i}-BLU-M`, color: 'Blue', size: 'M', price: 48.00 + i, currentStock: 5 + i },
                            { sku: `SKU-${prefix}-${i}-BLK-L`, color: 'Black', size: 'L', price: 50.00 + i, currentStock: 2 },
                        ],
                    },
                },
            });
        }
    };

    // 4. GENERATE MASSIVE PRODUCT DATA
    await createProducts(aura.id, 'Dresses', 15, 'Elegant');
    await createProducts(aura.id, 'Suits', 10, 'Executive');
    await createProducts(tech.id, 'Audio', 12, 'Sonic');
    await createProducts(tech.id, 'Computing', 10, 'Titan');
    await createProducts(eco.id, 'Kitchen', 15, 'Bamboo');

    console.log('60+ Products and 180+ Variants created.');

    // 5. CREATE DISCOUNTS
    await prisma.discount.createMany({
        data: [
            { merchantId: aura.id, code: 'ELEGANCE10', discountType: 'PERCENTAGE', value: 10 },
            { merchantId: tech.id, code: 'TECH50', discountType: 'FIXED_AMOUNT', value: 50 },
            { merchantId: eco.id, code: 'GREEN15', discountType: 'PERCENTAGE', value: 15 },
        ],
    });

    // 6. CREATE TEST CUSTOMER & SESSION
    const customer = await prisma.customer.create({
        data: { phoneNumber: '919876543210', name: 'John Doe' },
    });

    await prisma.userSession.create({
        data: {
            customerId: customer.id,
            merchantId: aura.id,
            currentCartJson: JSON.stringify([{ sku: 'SKU-Elegant-1-RED-S', quantity: 1 }]),
            sessionStatus: 'active',
        },
    });

    console.log('Discounts and Test Sessions created.');
    console.log('--- Seed Process Complete ---');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });