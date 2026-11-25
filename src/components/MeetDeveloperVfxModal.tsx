import React, { useEffect } from 'react';
import {
  X,
  Phone,
  MessageCircle,
  Instagram,
  Globe,
  Award,
  Tv,
  GraduationCap,
  ShieldCheck,
  Briefcase,
  Target,
  Layers,
  Building2,
} from 'lucide-react';

interface MeetDeveloperVfxModalProps {
  onClose: () => void;
}

const DEVELOPER_PROJECTS = [
  {
    number: '01',
    title: '1. Ashoka Playlist Playout',
    description:
      'A television playlist playout software designed especially for local news channels and cable TV operators. It helps channels manage video playlists, news content, advertisements, banners, logos, tickers, and continuous streaming with direct RTMP output. It makes daily news broadcasting and advertisement management easier.',
  },
  {
    number: '02',
    title: '2. Ashoka Cable TV Playout',
    description:
      'A dedicated cable television playout solution designed for local cable TV channels. It supports broadcasting operations with a second display output, making it easier to manage programme output and monitor the live broadcast independently.',
  },
  {
    number: '03',
    title: '3. Ashoka Monitor Wall Software',
    description:
      'A multi-channel monitoring solution that allows users to watch up to 16 television channels on a single monitor. Satellite television operations commonly use multi-channel monitoring systems, but smaller local cable channels may find such solutions expensive or difficult to access. My aim is to make this technology accessible to local channels at an affordable cost.',
  },
  {
    number: '04',
    title: '4. MSO Audio Play – Android Box Solution',
    description:
      'A solution developed for Multi-System Operators (MSOs) and local cable TV networks to simplify audio channel playback. Sometimes Android TV boxes used in cable network operations may experience playback or application issues. To address these practical challenges, I am developing an alternative system using a Mini PC that can be installed at the MSO location and used for continuous audio channel playback. This helps operators manage their audio channels more conveniently.',
  },
  {
    number: '05',
    title: '5. Ashoka Prompter',
    description:
      'A teleprompter solution designed for news presenters, VJs, RJs, journalists, and media production teams. It helps presenters read news scripts and programme content smoothly during recording and live broadcasting. My aim is to make this tool freely accessible to aspiring journalists and media students.',
  },
];

export const MeetDeveloperVfxModal: React.FC<MeetDeveloperVfxModalProps> = ({
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/90 overflow-hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Founder & Developer Profile — Ashoka Cable TV Playout"
        className="relative w-full max-w-6xl max-h-[92vh] bg-[#0a0f1a] border border-slate-700/80 rounded-xl flex flex-col overflow-hidden text-slate-100 shadow-2xl"
      >
        {/* Top Corporate Accent Rule */}
        <div className="h-1 w-full bg-gradient-to-r from-amber-500 via-sky-600 to-amber-500 shrink-0" />

        {/* Header */}
        <div className="px-5 py-3.5 bg-[#0f1626] border-b border-slate-700/70 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/assets/ashoka-icon.svg?v=2026.12"
              alt="Ashoka Media Technology"
              className="w-9 h-9 rounded-lg border border-slate-600 bg-slate-950 p-0.5 shrink-0"
            />
            <div className="min-w-0">
              <div className="text-[11px] font-mono font-bold tracking-wider uppercase text-amber-400">
                Ashoka Entertainment &amp; Ashoka Media Technology
              </div>
              <h2 className="text-sm sm:text-base font-bold tracking-wide text-white truncate">
                Founder &amp; Developer Profile — Ashoka Cable TV Playout
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
            <span>Close</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
          {/* 1. FOUNDER SECTION FIRST */}
          <section className="rounded-xl bg-[#12110e] border border-amber-500/50 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-600/30 pb-3">
              <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-wider text-amber-400">
                <Award className="w-4 h-4 text-amber-400 shrink-0" />
                <span>FOUNDER · ASHOKA ENTERTAINMENT</span>
              </div>
              <span className="text-[11px] font-mono font-semibold text-amber-300/90">
                LEADERSHIP &amp; MEDIA PIONEER
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-8 space-y-3.5">
                <div className="flex items-center gap-3.5">
                  <div className="w-14 h-14 rounded-xl bg-amber-500/20 border border-amber-500/60 flex items-center justify-center text-amber-300 font-bold text-lg shrink-0">
                    LN
                  </div>
                  <div>
                    <h3 className="text-xl sm:text-2xl font-bold text-white">
                      Lakshmana Nagarajan
                    </h3>
                    <div className="text-xs sm:text-sm font-semibold text-amber-300 mt-0.5">
                      லட்சுமண நாகராஜன் · Lakshmana Nagarajan
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/75 border border-slate-800 space-y-2.5 text-xs sm:text-[13px] text-slate-200 leading-relaxed">
                  <p className="font-semibold text-amber-200">
                    அசோகா என்டர்டெயின்மென்ட் நிறுவனத்தின் நிறுவனர் மற்றும் முன்னோடி.
                  </p>
                  <p>
                    அசோகா டிவி, அசோகா டிஜிட்டல் Live TV App, அசோகா Ads, அசோகா Audios உள்ளிட்ட பல்வேறு ஊடக மற்றும் ஒளிபரப்பு தளங்களை முன்னெடுத்து வரும் முக்கிய நிர்வாகி.
                  </p>
                  <p>
                    செயற்கைக்கோள் தொலைக்காட்சி, IP ஒளிபரப்பு சேவைகள் மற்றும் திரைப்பட காப்புரிமை (Film Copyrights) துறைகளில் சிறப்பாக செயல்பட்டு, சேனல்களின் உள்ளடக்கம், விநியோகம் மற்றும் ஒளிபரப்பு அடையாளத்தை உருவாக்கிய தொலைநோக்கு பார்வையாளர்.
                  </p>
                  <p className="font-semibold text-emerald-300">
                    2004 முதல் ஊடகத் துறையில் தொடர்ந்து செயல்பட்டு வரும் அனுபவமிக்க மீடியா தொழில்முனைவோர்.
                  </p>
                </div>
              </div>

              {/* Founder Contact Card */}
              <div className="lg:col-span-4 rounded-xl bg-[#0b0d13] border border-amber-600/35 p-4 space-y-2.5">
                <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-amber-400">
                  Founder Contact
                </div>

                <a
                  href="https://facebook.com/lakshmana.nagarajan"
                  target="_blank"
                  rel="noreferrer"
                  className="p-3 rounded-lg bg-[#0d172a] hover:bg-[#13223d] border border-slate-700 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono uppercase text-slate-400">Facebook</div>
                    <div className="font-mono font-bold text-white truncate">
                      facebook.com/lakshmana.nagarajan
                    </div>
                  </div>
                  <Globe className="w-4 h-4 text-sky-400 shrink-0" />
                </a>

                <a
                  href="tel:+919600329596"
                  className="p-3 rounded-lg bg-[#1c160b] hover:bg-[#261e0e] border border-amber-600/40 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="text-[10px] font-mono uppercase text-amber-300/80">Office</div>
                    <div className="font-mono font-bold text-amber-300 tabular-nums">
                      +91 96003 29596
                    </div>
                  </div>
                  <Phone className="w-4 h-4 text-amber-400 shrink-0" />
                </a>
              </div>
            </div>
          </section>

          {/* 2. DEVELOPER IDENTITY BANNER */}
          <section className="rounded-xl bg-[#0e1525] border border-slate-700/70 p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="flex items-start sm:items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-slate-900 border border-sky-500/50 flex items-center justify-center text-sky-300 font-bold text-lg tracking-wider shrink-0">
                  NK
                </div>
                <div>
                  <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                    N. N. KANISHQ KUMAR
                  </h3>
                  <p className="text-xs sm:text-sm font-medium text-sky-300 mt-1">
                    Media Technology Developer | Television Broadcasting Professional | Software Developer | Research Scholar
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-[11px] font-semibold text-amber-300 flex items-center gap-1.5">
                  <Tv className="w-3.5 h-3.5" />
                  5+ Years TV Broadcasting
                </span>
                <span className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-[11px] font-semibold text-sky-300 flex items-center gap-1.5">
                  <GraduationCap className="w-3.5 h-3.5" />
                  B.Sc • M.A • Ph.D. Scholar
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-8 space-y-3 text-xs sm:text-sm text-slate-200 leading-relaxed">
                <p>
                  I am <strong className="text-white">N. N. Kanishq Kumar</strong>, a television broadcasting professional, media technology developer, and software designer with over 5 years of experience in TV channel broadcasting and live production. I have completed my academic studies in <strong className="text-white">B.Sc. Visual Communication</strong> and <strong className="text-white">M.A. Journalism and Mass Communication</strong>, and I am currently pursuing a <strong className="text-white">Ph.D. in Journalism and Mass Communication</strong>.
                </p>
                <p className="text-slate-300">
                  My professional experience in television broadcasting and live production has helped me understand the everyday technical challenges faced by television channels, cable TV operators, MSOs, journalists, and media professionals. Based on these practical experiences, I started developing affordable software solutions that simplify television broadcasting and media production.
                </p>
              </div>

              {/* Developer Contact Panel */}
              <div className="lg:col-span-4 rounded-xl bg-[#090e18] border border-slate-800 p-3.5 space-y-2.5">
                <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-sky-400">
                  Developer Contact
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
                  <a
                    href="tel:+919842736137"
                    className="px-3 py-2 rounded-lg bg-[#10192b] hover:bg-[#16223a] border border-slate-700/80 flex items-center justify-between text-xs"
                  >
                    <span className="text-slate-300">Primary Phone</span>
                    <span className="font-mono font-bold text-white tabular-nums flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-sky-400" />
                      +91 98427 36137
                    </span>
                  </a>
                  <a
                    href="tel:+919600329596"
                    className="px-3 py-2 rounded-lg bg-[#10192b] hover:bg-[#16223a] border border-slate-700/80 flex items-center justify-between text-xs"
                  >
                    <span className="text-slate-300">Support Desk</span>
                    <span className="font-mono font-bold text-white tabular-nums flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-emerald-400" />
                      +91 96003 29596
                    </span>
                  </a>
                  <a
                    href="https://wa.me/919842736137"
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 rounded-lg bg-[#0b1f1a] hover:bg-[#0f2922] border border-emerald-700/50 flex items-center justify-between text-xs"
                  >
                    <span className="text-emerald-200">WhatsApp</span>
                    <span className="font-mono font-bold text-emerald-300 tabular-nums flex items-center gap-1.5">
                      <MessageCircle className="w-3.5 h-3.5" />
                      +91 98427 36137
                    </span>
                  </a>
                  <a
                    href="https://instagram.com/kanishq_broadcaster"
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 rounded-lg bg-[#191124] hover:bg-[#231733] border border-pink-700/40 flex items-center justify-between text-xs"
                  >
                    <span className="text-pink-200">Instagram</span>
                    <span className="font-mono font-bold text-white flex items-center gap-1.5">
                      <Instagram className="w-3.5 h-3.5 text-pink-400" />
                      @kanishq_broadcaster
                    </span>
                  </a>
                </div>
              </div>
            </div>
          </section>

          {/* 3. MY SOFTWARE DEVELOPMENT PROJECTS */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Briefcase className="w-4 h-4 text-sky-400" />
              <h3 className="text-sm sm:text-base font-bold uppercase tracking-wide text-white">
                My Software Development Projects
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {DEVELOPER_PROJECTS.map((project, idx) => (
                <div
                  key={project.number}
                  className={`rounded-xl bg-[#0e1525] border border-slate-700/70 p-4 space-y-2 ${
                    idx === DEVELOPER_PROJECTS.length - 1 ? 'md:col-span-2' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-sky-400 shrink-0" />
                      <span>{project.title}</span>
                    </h4>
                    <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-900 border border-slate-700 px-2 py-0.5 rounded">
                      PROJECT {project.number}
                    </span>
                  </div>
                  <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                    {project.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* 4. MY VISION AND MISSION */}
          <section className="rounded-xl bg-[#0e1525] border border-slate-700/70 p-5 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Target className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm sm:text-base font-bold uppercase tracking-wide text-white">
                My Vision and Mission
              </h3>
            </div>

            <div className="space-y-2.5 text-xs sm:text-[13px] text-slate-300 leading-relaxed">
              <p>
                My main objective is to develop practical, affordable, and user-friendly broadcasting software for the television and media industry.
              </p>
              <p>
                Many professional broadcasting solutions are expensive, making them difficult for small television channels, local cable operators, and independent media organisations to afford. I want to bridge this gap by developing low-cost and accessible software using my practical broadcasting experience and technical knowledge.
              </p>
              <p>
                My focus is not only on developing software but also on helping local television channels modernise their broadcasting systems, improve their production quality, simplify their daily operations, and adopt new media technologies.
              </p>
              <p>
                I also want to make these tools accessible to journalism students, visual communication students, media production learners, independent journalists, and emerging media professionals.
              </p>
              <p className="text-slate-100 font-medium">
                My vision is to connect journalism, broadcasting experience, and software technology to create affordable media solutions for everyone.
              </p>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center gap-2 text-xs font-semibold text-amber-300">
              <Building2 className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Developed under the Ashoka Media Technology initiative.</span>
            </div>
          </section>

          {/* Corporate Copyright & Legal Protection Notice */}
          <footer className="rounded-xl bg-[#0e131f] border border-slate-700/80 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-amber-400 shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="space-y-0.5 text-xs">
                <div className="font-bold text-white">
                  © 2026 Ashoka Media Technology &amp; Ashoka Cable TV Playout — N. N. Kanishq Kumar. All Rights Reserved.
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Protected intellectual property of N. N. Kanishq Kumar (Ashoka Media Technology). Unauthorized copying, reverse engineering, rebranding, or commercial redistribution without written authorization is strictly prohibited under applicable copyright law.
                </p>
              </div>
            </div>
            <div className="text-[11px] font-mono text-slate-400 shrink-0">
              ASHOKA MEDIA TECHNOLOGY
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};
