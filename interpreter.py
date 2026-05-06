from textx import metamodel_from_file
from preprocess import preprocess
from pathlib import Path

class PulseReturn(Exception):
    def __init__(self, value):
        self.value = value


class PulseRuntimeError(Exception):
    pass

class Env:
    def __init__(self, parent=None):
        self.vars = {}
        self.parent = parent

    def get(self, name):
        if name in self.vars:
            return self.vars[name]
        if self.parent:
            return self.parent.get(name)
        raise PulseRuntimeError(f"undefined name: {name}")

    def set_local(self, name, value):
        self.vars[name] = value

    def assign(self, name, value):
       
        env = self
        while env is not None:
            if name in env.vars:
                env.vars[name] = value
                return
            env = env.parent
        raise PulseRuntimeError(f"cannot update undeclared name: {name}")



class Interpreter:
    def __init__(self):
        self.global_env = Env()
        self.protocols = {}        
        self.output = []           
        self.pulses = []          

    def emit(self, kind, detail=""):
        """Record a pulse event"""
        self.pulses.append((kind, detail))

    def run(self, program):
        for stmt in program.statements:
            if stmt.__class__.__name__ == "Protocol":
                self.protocols[stmt.name] = stmt

        for stmt in program.statements:
            self.exec_stmt(stmt, self.global_env)

        self.emit("flatline")


    def exec_stmt(self, stmt, env):
        cls = stmt.__class__.__name__
        method = getattr(self, f"exec_{cls}", None)
        if method is None:
            raise PulseRuntimeError(f"unknown statement type: {cls}")
        return method(stmt, env)

    def exec_Admit(self, stmt, env):
        value = self.eval_expr(stmt.value, env)
        env.set_local(stmt.name, value)
        self.emit("admit", f"{stmt.name} = {value!r}")

    def exec_Update(self, stmt, env):
        value = self.eval_expr(stmt.value, env)
        env.assign(stmt.name, value)
        self.emit("update", f"{stmt.name} = {value!r}")

    def exec_Protocol(self, stmt, env):
        self.emit("protocol_def", stmt.name)

    def exec_PageStmt(self, stmt, env):
        self._invoke_protocol(stmt.name, stmt.args, env)

    def exec_Monitor(self, stmt, env):
        self.emit("monitor_enter")
        while self._truthy(self.eval_expr(stmt.condition, env)):
            self.emit("monitor_tick")
            block_env = Env(parent=env)
            for inner in stmt.body:
                self.exec_stmt(inner, block_env)
        self.emit("monitor_exit")

    def exec_Cycle(self, stmt, env):
        iterable = self.eval_expr(stmt.iterable, env)
        try:
            iterator = iter(iterable)
        except TypeError:
            raise PulseRuntimeError(f"cannot cycle over {iterable!r}")
        self.emit("cycle_enter")
        for item in iterator:
            self.emit("cycle_tick", repr(item))
            block_env = Env(parent=env)
            block_env.set_local(stmt.var, item)
            for inner in stmt.body:
                self.exec_stmt(inner, block_env)
        self.emit("cycle_exit")

    def exec_Diagnose(self, stmt, env):
        cond = self.eval_expr(stmt.condition, env)
        if self._truthy(cond):
            self.emit("diagnose_true")
            block_env = Env(parent=env)
            for inner in stmt.body:
                self.exec_stmt(inner, block_env)
        elif stmt.otherwise is not None:
            self.emit("diagnose_false")
            block_env = Env(parent=env)
            for inner in stmt.otherwise.body:
                self.exec_stmt(inner, block_env)

    def exec_TryBlock(self, stmt, env):
        self.emit("code_enter")
        try:
            block_env = Env(parent=env)
            for inner in stmt.try_body:
                self.exec_stmt(inner, block_env)
        except PulseRuntimeError as e:
            self.emit("respond", str(e))
            catch_env = Env(parent=env)
            catch_env.set_local(stmt.err_name, str(e))
            for inner in stmt.catch_body:
                self.exec_stmt(inner, catch_env)

    def exec_Record(self, stmt, env):
        value = self.eval_expr(stmt.value, env)
        rendered = self._render(value)
        self.output.append(rendered)
        self.emit("record", rendered)

    def exec_Discharge(self, stmt, env):
        value = self.eval_expr(stmt.value, env) if stmt.value is not None else None
        self.emit("discharge", repr(value))
        raise PulseReturn(value)

    def _invoke_protocol(self, name, arg_nodes, env):
        if name not in self.protocols:
            raise PulseRuntimeError(f"undefined protocol: {name}")
        proto = self.protocols[name]
        if len(arg_nodes) != len(proto.params):
            raise PulseRuntimeError(
                f"protocol {name} expects {len(proto.params)} args, got {len(arg_nodes)}"
            )
        call_env = Env(parent=self.global_env)
        for param, arg in zip(proto.params, arg_nodes):
            call_env.set_local(param, self.eval_expr(arg, env))
        self.emit("page", name)
        try:
            for inner in proto.body:
                self.exec_stmt(inner, call_env)
        except PulseReturn as r:
            return r.value
        return None

    def eval_expr(self, node, env):
        cls = node.__class__.__name__
        method = getattr(self, f"eval_{cls}", None)
        if method is None:
            raise PulseRuntimeError(f"unknown expression type: {cls}")
        return method(node, env)

    def eval_Or(self, node, env):
        result = self.eval_expr(node.left, env)
        for right in node.right:
            if self._truthy(result):
                return result
            result = self.eval_expr(right, env)
        return result

    def eval_And(self, node, env):
        result = self.eval_expr(node.left, env)
        for right in node.right:
            if not self._truthy(result):
                return result
            result = self.eval_expr(right, env)
        return result

    def eval_Not(self, node, env):
        v = self.eval_expr(node.expr, env)
        return (not self._truthy(v)) if node.negated else v

    def eval_Comparison(self, node, env):
        result = self.eval_expr(node.left, env)
        for op, right_node in zip(node.op, node.right):
            right = self.eval_expr(right_node, env)
            if   op == "==": result = (result == right)
            elif op == "!=": result = (result != right)
            elif op == "<":  result = (result <  right)
            elif op == ">":  result = (result >  right)
            elif op == "<=": result = (result <= right)
            elif op == ">=": result = (result >= right)
        return result

    def eval_Additive(self, node, env):
        result = self.eval_expr(node.left, env)
        for op, right_node in zip(node.op, node.right):
            right = self.eval_expr(right_node, env)
            if   op == "+": result = result + right
            elif op == "-": result = result - right
        return result

    def eval_Multiplicative(self, node, env):
        result = self.eval_expr(node.left, env)
        for op, right_node in zip(node.op, node.right):
            right = self.eval_expr(right_node, env)
            if   op == "*": result = result * right
            elif op == "/":
                if right == 0:
                    raise PulseRuntimeError("divided by zero")
                result = result / right
            elif op == "%":
                if right == 0:
                    raise PulseRuntimeError("modulo by zero")
                result = result % right
        return result

    def eval_Unary(self, node, env):
        v = self.eval_expr(node.atom, env)
        return -v if node.neg else v

    def eval_NumberLit(self, node, env):  return node.value
    def eval_StringLit(self, node, env):  return node.value
    def eval_BoolLit(self, node, env):    return bool(node.value)
    def eval_ChartLit(self, node, env):
        return [self.eval_expr(item, env) for item in node.items]

    def eval_PageCall(self, node, env):
        return self._invoke_protocol(node.name, node.args, env)

    def eval_RangeCall(self, node, env):
        args = [self.eval_expr(a, env) for a in node.args]
        return list(range(*[int(a) for a in args]))

    def eval_VarRef(self, node, env):
        return env.get(node.name)

    def eval_ParenExpr(self, node, env):
        return self.eval_expr(node.expr, env)

    @staticmethod
    def _truthy(v):
        return bool(v)

    @staticmethod
    def _render(v):
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return str(v)

_metamodel = None

def _load_metamodel():
    global _metamodel
    if _metamodel is None:
        grammar_path = Path(__file__).parent / "pulse.tx"
        _metamodel = metamodel_from_file(str(grammar_path))
    return _metamodel


def run_pulse(source: str):
    mm = _load_metamodel()
    preprocessed = preprocess(source)
    program = mm.model_from_str(preprocessed)
    interp = Interpreter()
    interp.run(program)
    return interp.output, interp.pulses