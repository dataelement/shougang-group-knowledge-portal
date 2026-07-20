import { BookOpen, Building2, Clock, GraduationCap, UserCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { fetchCourses } from '../api/courses';
import PageShell from '../components/PageShell';
import type { Course } from '../types/course';
import { formatCourseDuration } from '../types/course';
import s from './CourseListPage.module.css';

export default function CourseListPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void fetchCourses('all')
      .then((items) => {
        if (active) setCourses(items);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : '课程加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <PageShell>
      <section className={s.hero}>
        <div className={s.heroInner}>
          <div className={s.eyebrow}>SHOUGANG · 岗位赋能</div>
          <h1>专业课程</h1>
          <p>围绕生产经营场景沉淀岗位知识，以体系化课程赋能专业成长。</p>
        </div>
      </section>
      <div className={s.container}>
        <div className={s.titleRow}>
          <div>
            <Link to="/" className={s.backLink}>返回首页</Link>
            <h2>全部课程</h2>
          </div>
          {!loading && !error ? <span className={s.count}>共 {courses.length} 门</span> : null}
        </div>

        {loading ? <div className={s.state}>正在加载课程...</div> : null}
        {!loading && error ? (
          <div className={`${s.state} ${s.error}`} role="alert">{error}</div>
        ) : null}
        {!loading && !error && courses.length === 0 ? (
          <div className={s.empty}>
            <BookOpen size={38} />
            <strong>暂无已发布课程</strong>
            <span>管理员发布课程后会显示在这里。</span>
          </div>
        ) : null}

        <div className={s.grid}>
          {courses.map((course) => (
            <Link key={course.id} to={`/course/${course.id}`} className={s.card}>
              <div className={s.cardVisual}>
                <GraduationCap size={34} />
                <span>{course.videoCount > 1 ? `${course.videoCount} 个视频` : '单视频课程'}</span>
              </div>
              <div className={s.cardBody}>
                <div className={s.tags}>
                  {course.tags.map((tag) => (
                    <span key={`${tag.displayType}-${tag.label}`} data-tone={tag.displayType}>
                      {tag.label}
                    </span>
                  ))}
                </div>
                <h3>{course.name}</h3>
                {course.description ? <p>{course.description}</p> : null}
                <div className={s.meta}>
                  <span><Clock size={14} />{formatCourseDuration(course.totalDurationSeconds)}</span>
                  {course.instructor ? <span><UserCircle size={14} />{course.instructor}</span> : null}
                  {course.organization ? <span><Building2 size={14} />{course.organization}</span> : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
