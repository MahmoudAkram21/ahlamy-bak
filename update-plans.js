const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function updatePlans() {
  try {
    console.log('Updating existing plans with letter quotas...')
    
    // Update all plans that have NULL letter_quota
    const plans = await prisma.plan.findMany({
      where: {
        letterQuota: null
      }
    })
    
    console.log(`Found ${plans.length} plans to update`)
    
    for (const plan of plans) {
      // Set default letter quota based on plan name or use a default
      let letterQuota = 1500 // default
      
      if (plan.name.includes('مجاني') || plan.name.includes('Free')) {
        letterQuota = 500
      } else if (plan.name.includes('أساسي') || plan.name.includes('Basic')) {
        letterQuota = 1500
      } else if (plan.name.includes('احترافي') || plan.name.includes('Professional')) {
        letterQuota = 3000
      } else if (plan.name.includes('مميز') || plan.name.includes('Premium')) {
        letterQuota = 5000
      }
      
      await prisma.$executeRaw`
        UPDATE plans 
        SET letter_quota = ${letterQuota}
        WHERE id = ${plan.id}
      `
      
      console.log(`✅ Updated plan ${plan.name} with ${letterQuota} letter quota`)
    }
    
    console.log('\n✅ All plans updated!')
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

updatePlans()

