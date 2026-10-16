import { Workspace } from '@/components/workspace';
export function generateStaticParams() { return ['dashboard','history','devices','activity','settings','help'].map(section => ({ section })); }
export default async function Page({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; return <Workspace page={section}/>; }
