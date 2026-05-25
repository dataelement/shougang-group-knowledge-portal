import {
  Settings,
  Factory,
  Snowflake,
  Zap,
  Shield,
  CheckCircle,
  Leaf,
  Truck,
  Network,
  Wrench,
  GraduationCap,
  Star,
  AlertTriangle,
  FileText,
  BriefcaseBusiness,
  Layers3,
  ScrollText,
  FolderOpen,
  Search,
  Bot,
  BarChart3,
  MessageSquare,
  PenLine,
  Globe,
  LayoutGrid,
  TrendingUp,
  Tag,
  User,
  Download,
  Send,
  Plus,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react';
import s from './DomainIcon.module.css';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  Settings,
  Factory,
  Snowflake,
  Zap,
  Shield,
  CheckCircle,
  Leaf,
  Truck,
  Network,
  Wrench,
  GraduationCap,
  Star,
  AlertTriangle,
  FileText,
  BriefcaseBusiness,
  Layers3,
  ScrollText,
  FolderOpen,
  Search,
  Bot,
  BarChart3,
  MessageSquare,
  PenLine,
  Globe,
  LayoutGrid,
  TrendingUp,
  Tag,
  User,
  Download,
  Send,
  Plus,
  ArrowLeft,
  ChevronRight,
};

interface Props {
  icon: string;
  color: string;
  bg: string;
  size?: number;
}

export default function DomainIcon({ icon, color, bg, size = 48 }: Props) {
  const IconComp = ICON_MAP[icon];
  if (!IconComp) return null;

  return (
    <div
      className={s.wrap}
      style={{
        width: size,
        height: size,
        background: bg,
        color,
      }}
    >
      <IconComp size={Math.round(size / 2)} />
    </div>
  );
}
