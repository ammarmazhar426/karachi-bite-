import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();

const menu = [
  ["Classic Beef Burger","Juicy beef patty, lettuce and house sauce","Burgers","https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=900", [["Single",650],["Double",950]]],
  ["Crispy Chicken Burger","Crispy chicken, slaw and spicy mayo","Burgers","https://images.unsplash.com/photo-1606755962773-d324e0a13086?w=900", [["Single",550],["Double",850]]],
  ["Loaded Fries","Golden fries with cheese and signature sauce","Sides","https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=900", [["Regular",350],["Large",500]]],
  ["Pepperoni Pizza","Mozzarella, pepperoni and tomato sauce","Pizza","https://images.unsplash.com/photo- pizza-?w=900", [["Small",900],["Large",1450]]],
  ["Chocolate Shake","Thick chocolate milkshake","Drinks","https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=900", [["Regular",400],["Large",550]]]
];
async function main(){
  const email = process.env.ADMIN_EMAIL || "admin@karachibites.local";
  const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  await prisma.user.upsert({where:{email},update:{},create:{email,name:"Restaurant Admin",passwordHash:await bcrypt.hash(password,12)}});
  for (const [name,description,category,imageUrl,variants] of menu) {
    if (name.includes("Pepperoni")) continue;
    const existing = await prisma.product.findFirst({where:{name}});
    if (!existing) await prisma.product.create({data:{name,description,category,imageUrl,variants:{create:variants.map(([name,price])=>({name,price}))}}});
  }
  for (let i=1;i<=12;i++) await prisma.restaurantTable.upsert({where:{code:`T${i}`},update:{},create:{code:`T${i}`,label:`Table ${i}`}});
}
main().then(()=>console.log("Seed complete")).catch(e=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());
