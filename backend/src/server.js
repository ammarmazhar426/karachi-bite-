import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { randomInt } from "node:crypto";

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env.PORT || 4000);
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use("/api", rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:true,legacyHeaders:false}));

const asyncHandler = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const auth = (req,res,next) => {
  try {
    const token = req.cookies.session;
    if (!token) return res.status(401).json({error:"Authentication required"});
    req.user = jwt.verify(token,secret);
    next();
  } catch { return res.status(401).json({error:"Session expired. Please sign in again."}); }
};
const loginLimiter = rateLimit({windowMs:15*60*1000,limit:8, message:{error:"Too many login attempts. Try again later."}});
const money = n => Number.isInteger(n) && n >= 0 && n <= 10000000;
const areas = ["Gulshan-e-Iqbal","DHA","Clifton","Malir","North Nazimabad","Gulistan-e-Johar","PECHS","Saddar","Bahadurabad","Federal B Area"];

app.get("/api/health",(req,res)=>res.json({status:"ok"}));
app.get("/api/areas",(req,res)=>res.json(areas));
app.get("/api/menu",asyncHandler(async(req,res)=>{
  const products=await prisma.product.findMany({where:{active:true},include:{variants:true},orderBy:{createdAt:"desc"}});
  res.json(products);
}));
app.post("/api/auth/login",loginLimiter,asyncHandler(async(req,res)=>{
  const schema=z.object({email:z.string().email().max(254),password:z.string().min(8).max(128)});
  const parsed=schema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:"Enter a valid email and password."});
  const user=await prisma.user.findUnique({where:{email:parsed.data.email.toLowerCase()}});
  if(!user || !(await bcrypt.compare(parsed.data.password,user.passwordHash))) return res.status(401).json({error:"Invalid email or password."});
  const token=jwt.sign({sub:user.id,role:user.role},secret,{expiresIn:"8h"});
  res.cookie("session",token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",maxAge:8*60*60*1000});
  res.json({name:user.name,email:user.email});
}));
app.post("/api/auth/logout",(req,res)=>{res.clearCookie("session",{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production"});res.json({ok:true});});
app.get("/api/auth/me",auth,asyncHandler(async(req,res)=>{const u=await prisma.user.findUnique({where:{id:req.user.sub},select:{name:true,email:true,role:true}});res.json(u);}));

const orderSchema=z.object({
  channel:z.enum(["ONLINE","DINE_IN"]),customerName:z.string().trim().min(2).max(80),
  phone:z.string().trim().min(7).max(25),address:z.string().max(300).optional().default(""),
  area:z.string().max(80).optional().default(""),tableCode:z.string().max(20).optional().default(""),
  paymentMethod:z.enum(["COD","BANK_TRANSFER","PAY_AT_COUNTER"]),
  notes:z.string().max(500).optional().default(""),
  items:z.array(z.object({variantId:z.string().min(1),quantity:z.number().int().min(1).max(20)})).min(1).max(30)
});
app.post("/api/orders",asyncHandler(async(req,res)=>{
  const parsed=orderSchema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:"Please check your order details.",details:parsed.error.flatten()});
  const d=parsed.data;
  // A valid table code determines dine-in. Do not rely only on the
  // channel value supplied by the browser.
  const tableCode = d.tableCode.trim();
  const channel = tableCode ? "DINE_IN" : "ONLINE";

  if(channel==="ONLINE" && (!d.address.trim() || !areas.includes(d.area))) return res.status(400).json({error:"Select a valid delivery area and enter your address."});
  if(channel==="DINE_IN" && !/^T([1-9]|1[0-2])$/.test(tableCode)) return res.status(400).json({error:"Invalid table QR code."});
  const ids=d.items.map(i=>i.variantId);
  const variants=await prisma.productVariant.findMany({where:{id:{in:ids},product:{active:true}},include:{product:true}});
  if(variants.length!==new Set(ids).size) return res.status(400).json({error:"One or more menu items are unavailable. Refresh and try again."});
  const lookup=new Map(variants.map(v=>[v.id,v]));
  const items=d.items.map(i=>({variant:lookup.get(i.variantId),quantity:i.quantity}));
  const subtotal=items.reduce((sum,i)=>sum+i.variant.price*i.quantity,0);
  if(!money(subtotal)) return res.status(400).json({error:"Order total is invalid."});
  const deliveryFee=channel==="ONLINE"?150:0;
  const order=await prisma.order.create({data:{
    orderNumber:`KB-${Date.now().toString().slice(-6)}-${randomInt(100,999)}`,
    channel,customerName:d.customerName,phone:d.phone,address:d.address,area:d.area,
    tableCode:channel==="DINE_IN"?tableCode:"",paymentMethod:d.paymentMethod,notes:d.notes,subtotal,deliveryFee,total:subtotal+deliveryFee,
    items:{create:items.map(i=>({productName:i.variant.product.name,variantName:i.variant.name,quantity:i.quantity,unitPrice:i.variant.price}))}
  },include:{items:true}});
  res.status(201).json({message:"Order received",order});
}));
app.get("/api/orders",auth,asyncHandler(async(req,res)=>{
  const channel=req.query.channel;
  const where=channel==="ONLINE"||channel==="DINE_IN"?{channel}:{};
  const orders=await prisma.order.findMany({where,include:{items:true},orderBy:{createdAt:"desc"},take:150});
  res.json(orders);
}));
app.patch("/api/orders/:id/status",auth,asyncHandler(async(req,res)=>{
  const schema=z.object({status:z.enum(["NEW","ACCEPTED","PREPARING","READY","OUT_FOR_DELIVERY","COMPLETED","CANCELLED"]),paymentStatus:z.enum(["PENDING","PAID","FAILED"]).optional()});
  const p=schema.safeParse(req.body); if(!p.success)return res.status(400).json({error:"Invalid update"});
  const order=await prisma.order.update({where:{id:req.params.id},data:p.data,include:{items:true}});
  res.json(order);
}));
app.get("/api/analytics",auth,asyncHandler(async(req,res)=>{
  const now=new Date(); const start=new Date(now); start.setHours(0,0,0,0);
  const yesterday=new Date(start); yesterday.setDate(yesterday.getDate()-1);
  const month=new Date(now.getFullYear(),now.getMonth(),1);
  const [today,previous,monthly,counts]=await Promise.all([
    prisma.order.aggregate({where:{createdAt:{gte:start},status:{not:"CANCELLED"}},_sum:{total:true},_count:true}),
    prisma.order.aggregate({where:{createdAt:{gte:yesterday,lt:start},status:{not:"CANCELLED"}},_sum:{total:true},_count:true}),
    prisma.order.aggregate({where:{createdAt:{gte:month},status:{not:"CANCELLED"}},_sum:{total:true},_count:true}),
    prisma.order.groupBy({by:["channel"],where:{createdAt:{gte:start}},_count:true})
  ]);
  res.json({today:{sales:today._sum.total||0,orders:today._count},yesterday:{sales:previous._sum.total||0,orders:previous._count},month:{sales:monthly._sum.total||0,orders:monthly._count},channels:counts});
}));
app.post("/api/products",auth,asyncHandler(async(req,res)=>{
  const s=z.object({name:z.string().trim().min(2).max(100),description:z.string().max(500).default(""),category:z.string().max(60).default("Popular"),imageUrl:z.string().url().max(500).or(z.literal("")).default(""),variants:z.array(z.object({name:z.string().min(1).max(40),price:z.number().int().min(1).max(1000000)})).min(1).max(10)});
  const p=s.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid product details"});
  const product=await prisma.product.create({data:{...p.data,variants:{create:p.data.variants}} ,include:{variants:true}});
  res.status(201).json(product);
}));
app.patch("/api/products/:id",auth,asyncHandler(async(req,res)=>{
  const s=z.object({active:z.boolean().optional(),name:z.string().trim().min(2).max(100).optional(),description:z.string().max(500).optional(),category:z.string().max(60).optional(),imageUrl:z.string().url().max(500).or(z.literal("")).optional()});
  const p=s.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid product update"});
  res.json(await prisma.product.update({where:{id:req.params.id},data:p.data,include:{variants:true}}));
}));
app.get("/api/qr/:table.png",asyncHandler(async(req,res)=>{
  if(!/^T([1-9]|1[0-2])$/.test(req.params.table))return res.status(404).json({error:"Table not found"});
  const url=`${process.env.FRONTEND_URL||"http://localhost:5173"}/table/${req.params.table}`;
  res.type("png");
  QRCode.toFileStream(res,url,{type:"png",width:640,margin:2,errorCorrectionLevel:"H"});
}));
app.get("/api/qr/:table",asyncHandler(async(req,res)=>{
  if(!/^T([1-9]|1[0-2])$/.test(req.params.table))return res.status(404).json({error:"Table not found"});
  const url=`${process.env.FRONTEND_URL||"http://localhost:5173"}/table/${req.params.table}`;
  const data=await QRCode.toDataURL(url,{width:480,margin:2,errorCorrectionLevel:"H"});
  res.json({table:req.params.table,url,qr:data});
}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Something went wrong. Please try again."});});
app.listen(PORT,()=>console.log(`API running on http://localhost:${PORT}`));