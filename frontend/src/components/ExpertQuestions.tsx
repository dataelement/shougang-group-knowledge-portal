import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, ChevronRight, MessageSquarePlus } from 'lucide-react';
import { fetchExpertQuestions } from '../api/expertQa';
import s from './ExpertQuestions.module.css';

const DEBOUNCE_DELAY_MS = 300;
const EXPERT_QUESTION_LIMIT = 8;
const DEFAULT_ERROR_MESSAGE = '专家问答加载失败，请稍后重试';
const EXPERT_QA_PATH = '/expert-qa';
const EXPERT_QA_ASK_PATH = '/expert-qa/ask';
const EXPERT_QUESTION_SORT = 'latest';

type ExpertQuestionItem = {
  id: number;
  title: string;
};

interface ExpertQuestionsProps {
  className?: string;
}

/**
 * Render the home page expert QA module.
 *
 * @param props.className - Optional class name inherited from the host page layout.
 * @returns Expert question list panel with loading, error, and empty-slot states.
 */
export default function ExpertQuestions({ className = '' }: ExpertQuestionsProps) {
  const [questions, setQuestions] = useState<ExpertQuestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');

      fetchExpertQuestions({
        page: 1,
        pageSize: EXPERT_QUESTION_LIMIT,
        sort: EXPERT_QUESTION_SORT,
      })
        .then((response) => {
          if (!active) return;
          console.log('Raw API response for home expert questions:', response);
          const questionItems = response.questions
            .slice(0, EXPERT_QUESTION_LIMIT)
            .map((question) => ({
              id: question.id,
              title: question.title || '',
            }))
            .filter((question) => question.title.trim());
          setQuestions(questionItems);
          console.log('Loaded home expert questions:', questionItems);

        })
        .catch((err: unknown) => {
          if (!active) return;
          console.error('Failed to load home expert questions:', err);
          setQuestions([]);
          setError(err instanceof Error ? err.message : DEFAULT_ERROR_MESSAGE);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, DEBOUNCE_DELAY_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);



  return (
    <div className={`${s.panel} ${className}`}>
      <div className={s.header}>
        <div className={s.headerLeft}>
          <div className={s.panelIcon}>
            <Award size={14} />
          </div>
          <span className={s.panelTitle}>专家问答</span>
        </div>
        <Link to={EXPERT_QA_PATH} className={s.panelMore}>
          更多 <ChevronRight size={14} />
        </Link>
      </div>

      <Link to={EXPERT_QA_ASK_PATH} className={s.cta}>
        <MessageSquarePlus size={22} />
        <div className={s.ctaBody}>
          <div className={s.ctaTitle}>向专家提问</div>
        </div>
        <ChevronRight size={16} className={s.ctaCaret} />
      </Link>

      {loading ? (
        <div className={s.state} role="status">加载专家问题中...</div>
      ) : error ? (
        <div className={`${s.state} ${s.errorState}`} role="alert">{error}</div>
      ) : (
        <>
          <div className={s.grid}>
            {questions.map((question) => (
              <Link key={question.id} to={`${EXPERT_QA_PATH}/${question.id}`} className={s.item}>
                <span className={s.badge}>Q</span>
                <span className={s.text}>{question.title}</span>
              </Link>
            ))}

          </div>
        </>
      )}
    </div>
  );
}
