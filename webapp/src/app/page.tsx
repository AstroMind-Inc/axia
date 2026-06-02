// page.tsx
import { redirect } from 'next/navigation';

export default function Home() {
  // Redirect to the playground page
  redirect('/playground');
  
  // This part won't execute due to the redirect, but is needed for TypeScript
  return null;
}