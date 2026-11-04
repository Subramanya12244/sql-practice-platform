import { Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppLayout } from "./layouts/AppLayout";
import { AddQuestionPage } from "./pages/AddQuestionPage";
import { ConceptsPage } from "./pages/ConceptsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ImportPage } from "./pages/ImportPage";
import { MistakesPage } from "./pages/MistakesPage";
import { PracticePage } from "./pages/PracticePage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SchemaPage } from "./pages/SchemaPage";
import { QuestionsPage } from "./pages/QuestionsPage";
import { GitPracticePage } from "./pages/git/GitPracticePage";
import { GitProgressPage } from "./pages/git/GitProgressPage";
import { GitImportPage } from "./pages/git/GitImportPage";

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<PracticePage />} />
          <Route path="/questions" element={<QuestionsPage />} />
          <Route path="/questions/new" element={<AddQuestionPage />} />
          <Route path="/questions/:id" element={<PracticePage />} />
          <Route path="/progress" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/schema" element={<SchemaPage />} />
          <Route path="/mistakes" element={<MistakesPage />} />
          <Route path="/concepts" element={<ConceptsPage />} />
          <Route path="/import/chatgpt" element={<ImportPage />} />
          <Route path="/git" element={<GitPracticePage />} />
          <Route path="/git/progress" element={<GitProgressPage />} />
          <Route path="/git/import" element={<GitImportPage />} />
          <Route path="/git/:id" element={<GitPracticePage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
